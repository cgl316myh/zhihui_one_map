package com.anr.mineonemap.video;

import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.BizVideoCamera;
import com.anr.mineonemap.mapper.BizVideoCameraMapper;
import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class VideoConfigService {

    private static final Logger log = LoggerFactory.getLogger(VideoConfigService.class);
    private static final String SECRET_MASK = "********";

    private final CfgMapper cfgMapper;
    private final BizVideoCameraMapper videoCameraMapper;
    private final ObjectMapper objectMapper;
    private final RestClient restClient = RestClient.create();

    public VideoConfigService(CfgMapper cfgMapper, BizVideoCameraMapper videoCameraMapper, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.videoCameraMapper = videoCameraMapper;
        this.objectMapper = objectMapper;
    }

    public JsonNode getPlatformConfig() {
        return parsePayload(cfgMapper.getVideoPlatformPayload());
    }

    public JsonNode getPlatformConfigForAdmin() {
        ObjectNode copy = getPlatformConfig().deepCopy();
        maskSecret(copy.path("hikvision"), "password");
        maskSecret(copy.path("zlm"), "secret");
        return copy;
    }

    public void updatePlatformConfig(JsonNode body, String actor) {
        if (body == null || !body.isObject()) {
            throw new BizException("平台配置须为 JSON 对象");
        }
        ObjectNode merged = getPlatformConfig().deepCopy();
        if (body.has("enabled")) {
            merged.put("enabled", body.get("enabled").asBoolean());
        }
        if (body.has("provider")) {
            merged.put("provider", body.get("provider").asText("hikvision"));
        }
        mergeObjectNode(merged, "hikvision", body.path("hikvision"), "password");
        mergeObjectNode(merged, "hls", body.path("hls"), null);
        mergeObjectNode(merged, "zlm", body.path("zlm"), "secret");
        savePlatform(merged, actor);
    }

    public List<BizVideoCamera> listCameras() {
        return videoCameraMapper.listAll();
    }

    public void replaceCameras(List<BizVideoCamera> cameras, String actor) {
        List<BizVideoCamera> existing = videoCameraMapper.listAll();
        for (BizVideoCamera cam : existing) {
            videoCameraMapper.deleteById(cam.getId());
        }
        int i = 0;
        JsonNode platform = getPlatformConfig();
        for (BizVideoCamera cam : cameras) {
            if (cam.getId() == null || cam.getId().isBlank()) {
                continue;
            }
            if (cam.getSortNo() == null) {
                cam.setSortNo(++i);
            }
            if (cam.getExtra() == null || cam.getExtra().isBlank()) {
                cam.setExtra("{}");
            }
            if (cam.getOnline() == null) {
                cam.setOnline(false);
            }
            videoCameraMapper.upsert(cam);
            registerZlmProxy(platform, cam);
        }
        log.info("video cameras updated by {} count={}", actor, cameras.size());
    }

    public Map<String, Object> buildDashboardVideoPayload() {
        JsonNode platform = getPlatformConfig();
        boolean enabled = platform.path("enabled").asBoolean(false);
        String provider = platform.path("provider").asText("hikvision");

        Map<String, Object> player = new LinkedHashMap<>();
        player.put("enabled", enabled);
        player.put("provider", provider);
        player.put("nvrHost", platform.path("hikvision").path("host").asText(""));

        List<Map<String, Object>> cameras = new ArrayList<>();
        for (BizVideoCamera cam : videoCameraMapper.listAll()) {
            cameras.add(toDashboardCamera(cam, platform, provider));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", enabled);
        result.put("player", player);
        result.put("cameras", cameras);
        result.put("updatedAt", Instant.now().toString());
        return result;
    }

    public Map<String, Object> testHikvision() {
        JsonNode platform = getPlatformConfig();
        JsonNode hik = platform.path("hikvision");
        String host = hik.path("host").asText("").trim();
        int port = hik.path("rtspPort").asInt(554);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("host", host);
        result.put("rtspPort", port);
        result.put("rtspPortOpen", host.isBlank() ? false : tcpOpen(host, port, 3000));
        result.put("examplePath", "/Streaming/Channels/101");
        String zlm = trimSlash(platform.path("zlm").path("baseUrl").asText(""));
        result.put("zlmBase", zlm);
        if (!zlm.isBlank()) {
            try {
                String body = restClient.get()
                        .uri(zlm + "/index/api/getServerConfig?secret="
                                + URLEncoder.encode(platform.path("zlm").path("secret").asText(""), StandardCharsets.UTF_8))
                        .retrieve()
                        .body(String.class);
                result.put("zlmOk", body != null && body.contains("\"code\":0"));
            } catch (Exception e) {
                result.put("zlmOk", false);
                result.put("zlmError", e.getMessage());
            }
        }
        return result;
    }

    private Map<String, Object> toDashboardCamera(BizVideoCamera cam, JsonNode platform, String provider) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", cam.getId());
        item.put("name", cam.getName());
        item.put("lng", cam.getLng());
        item.put("lat", cam.getLat());
        item.put("online", cam.getOnline());
        item.put("scene", cam.getScene());
        item.put("sortNo", cam.getSortNo());

        JsonNode extra = parseExtra(cam.getExtra());
        boolean camEnabled = !extra.has("enabled") || extra.path("enabled").asBoolean(true);
        item.put("enabled", camEnabled);

        int channelNo = extra.path("channelNo").asInt(1);
        String streamType = extra.path("streamType").asText("sub");
        String host = extra.path("host").asText("").trim();
        if (host.isBlank()) {
            host = platform.path("hikvision").path("host").asText("");
        }
        item.put("host", host);
        item.put("channelNo", channelNo);
        item.put("streamType", streamType);
        item.put("hikChannel", hikChannelId(channelNo, streamType));

        String camProvider = extra.path("provider").asText("").trim();
        if (camProvider.isBlank()) {
            camProvider = provider;
        }
        item.put("provider", camProvider);

        String hlsUrl = extra.path("hlsUrl").asText("").trim();
        String zlmStream = extra.path("zlmStream").asText("").trim();
        if (zlmStream.isBlank()) {
            zlmStream = streamName(cam.getId());
        }
        item.put("zlmStream", zlmStream);
        if (hlsUrl.isBlank()) {
            String pub = trimSlash(platform.path("zlm").path("publicBaseUrl").asText(""));
            if (pub.isBlank()) {
                pub = trimSlash(platform.path("zlm").path("baseUrl").asText(""));
            }
            if (!pub.isBlank() && !zlmStream.isBlank()) {
                hlsUrl = pub + "/live/" + zlmStream + "/hls.m3u8";
            }
        }
        if (!hlsUrl.isBlank()) {
            item.put("hlsUrl", hlsUrl);
        }
        item.put("canPlay", camEnabled && !hlsUrl.isBlank());
        return item;
    }

    private void registerZlmProxy(JsonNode platform, BizVideoCamera cam) {
        String rtsp = buildRtspUrl(platform, cam);
        if (rtsp.isBlank()) {
            return;
        }
        JsonNode extra = parseExtra(cam.getExtra());
        String stream = extra.path("zlmStream").asText("").trim();
        if (stream.isBlank()) {
            stream = streamName(cam.getId());
        }
        String base = trimSlash(platform.path("zlm").path("baseUrl").asText(""));
        if (base.isBlank() || stream.isBlank()) {
            return;
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        String secret = platform.path("zlm").path("secret").asText("");
        if (!secret.isBlank()) {
            form.add("secret", secret);
        }
        form.add("vhost", "__defaultVhost__");
        form.add("app", "live");
        form.add("stream", stream);
        form.add("url", rtsp);
        form.add("enable_hls", "1");
        form.add("enable_audio", "0");
        form.add("rtp_type", "0");
        try {
            String body = restClient.post()
                    .uri(base + "/index/api/addStreamProxy")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            log.info("ZLM proxy {} -> {} : {}", stream, maskRtsp(rtsp), body);
        } catch (Exception e) {
            log.warn("ZLM addStreamProxy {} failed: {}", stream, e.getMessage());
        }
    }

    private String buildRtspUrl(JsonNode platform, BizVideoCamera cam) {
        JsonNode extra = parseExtra(cam.getExtra());
        String override = extra.path("rtspUrl").asText("").trim();
        if (!override.isBlank()) {
            return override;
        }
        JsonNode hik = platform.path("hikvision");
        String host = extra.path("host").asText("").trim();
        if (host.isBlank()) {
            host = hik.path("host").asText("").trim();
        }
        String user = hik.path("username").asText("").trim();
        String pass = hik.path("password").asText("");
        int port = extra.path("rtspPort").asInt(0);
        if (port <= 0) {
            port = hik.path("rtspPort").asInt(554);
        }
        if (host.isBlank() || user.isBlank()) {
            return "";
        }
        int channelNo = extra.path("channelNo").asInt(1);
        String streamType = extra.path("streamType").asText("sub");
        int hikCh = hikChannelId(channelNo, streamType);
        String encUser = URLEncoder.encode(user, StandardCharsets.UTF_8);
        String encPass = URLEncoder.encode(pass, StandardCharsets.UTF_8);
        return "rtsp://" + encUser + ":" + encPass + "@" + host + ":" + port + "/Streaming/Channels/" + hikCh;
    }

    private static int hikChannelId(int channelNo, String streamType) {
        int ch = Math.max(1, channelNo);
        int stream = "main".equalsIgnoreCase(streamType) ? 1 : 2;
        return ch * 100 + stream;
    }

    private static String streamName(String camId) {
        if (camId == null || camId.isBlank()) {
            return "";
        }
        return camId.trim().toLowerCase().replace('_', '-');
    }

    private static boolean tcpOpen(String host, int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String maskRtsp(String rtsp) {
        return rtsp.replaceAll("://([^:]+):([^@]+)@", "://$1:****@");
    }

    private void savePlatform(JsonNode node, String actor) {
        try {
            cfgMapper.updateVideoPlatform(objectMapper.writeValueAsString(node), actor);
        } catch (Exception e) {
            throw new BizException("保存视频平台配置失败");
        }
    }

    private JsonNode parsePayload(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private JsonNode parseExtra(String extra) {
        try {
            return objectMapper.readTree(extra == null || extra.isBlank() ? "{}" : extra);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private void maskSecret(JsonNode parent, String field) {
        if (!(parent instanceof ObjectNode node)) {
            return;
        }
        String val = node.path(field).asText("");
        if (!val.isBlank()) {
            node.put(field, SECRET_MASK);
            node.put(field + "Set", true);
        } else {
            node.put(field + "Set", false);
        }
    }

    private void mergeObjectNode(ObjectNode merged, String key, JsonNode patch, String secretField) {
        if (!patch.isObject()) {
            return;
        }
        ObjectNode target = merged.withObject(key);
        patch.fields().forEachRemaining(e -> {
            if (secretField != null && secretField.equals(e.getKey())) {
                String val = e.getValue().asText("");
                if (!isMaskedSecret(val) && !val.isBlank()) {
                    target.put(secretField, val);
                }
                return;
            }
            target.set(e.getKey(), e.getValue());
        });
    }

    private boolean isMaskedSecret(String value) {
        return value == null || value.isBlank() || SECRET_MASK.equals(value) || value.contains("****");
    }

    private String trimSlash(String url) {
        if (url == null) {
            return "";
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
