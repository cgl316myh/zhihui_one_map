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

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class VideoConfigService {

    private static final Logger log = LoggerFactory.getLogger(VideoConfigService.class);
    private static final String SECRET_MASK = "********";

    private final CfgMapper cfgMapper;
    private final BizVideoCameraMapper videoCameraMapper;
    private final ObjectMapper objectMapper;
    private final RestClient restClient = RestClient.create();

    private volatile String cachedAccessToken;
    private volatile Instant cachedTokenExpireAt;

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
        maskSecret(copy.path("ezviz"), "appSecret");
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
            merged.put("provider", body.get("provider").asText("ezviz"));
        }
        mergeObjectNode(merged, "ezviz", body.path("ezviz"), "appSecret");
        mergeObjectNode(merged, "hls", body.path("hls"), null);
        mergeObjectNode(merged, "zlm", body.path("zlm"), "secret");
        savePlatform(merged, actor);
        cachedAccessToken = null;
        cachedTokenExpireAt = null;
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
        }
        log.info("video cameras updated by {} count={}", actor, cameras.size());
    }

    public Map<String, Object> buildDashboardVideoPayload() {
        JsonNode platform = getPlatformConfig();
        boolean enabled = platform.path("enabled").asBoolean(false);
        String provider = platform.path("provider").asText("ezviz");

        Map<String, Object> player = new LinkedHashMap<>();
        player.put("enabled", enabled);
        player.put("provider", provider);
        player.put("template", platform.path("ezviz").path("playerTemplate").asText("simple"));
        player.put("staticPath", platform.path("ezviz").path("staticPath").asText(""));
        player.put("domain", platform.path("ezviz").path("domain").asText("https://open.ys7.com"));

        if ("hls".equalsIgnoreCase(provider)) {
            player.put("fallbackUrl", platform.path("hls").path("fallbackUrl").asText(""));
        }

        String accessToken = null;
        String tokenError = null;
        if (enabled && "ezviz".equalsIgnoreCase(provider)) {
            try {
                accessToken = resolveEzvizAccessToken(platform);
            } catch (Exception e) {
                tokenError = e.getMessage();
                log.warn("ezviz token unavailable: {}", e.getMessage());
            }
        }
        player.put("accessToken", accessToken);
        if (tokenError != null) {
            player.put("tokenError", tokenError);
        }

        List<Map<String, Object>> cameras = new ArrayList<>();
        for (BizVideoCamera cam : videoCameraMapper.listAll()) {
            cameras.add(toDashboardCamera(cam, platform, provider, accessToken));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", enabled);
        result.put("player", player);
        result.put("cameras", cameras);
        result.put("updatedAt", Instant.now().toString());
        return result;
    }

    public Map<String, Object> testEzvizToken() {
        JsonNode platform = getPlatformConfig();
        String token = fetchEzvizToken(platform);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("accessTokenPreview", previewToken(token));
        result.put("expireAt", cachedTokenExpireAt != null ? cachedTokenExpireAt.toString() : null);
        return result;
    }

    private Map<String, Object> toDashboardCamera(BizVideoCamera cam, JsonNode platform, String provider, String accessToken) {
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

        String deviceSerial = extra.path("deviceSerial").asText("").trim().toUpperCase(Locale.ROOT);
        int channelNo = extra.path("channelNo").asInt(1);
        String streamType = extra.path("streamType").asText("sub");
        item.put("deviceSerial", deviceSerial);
        item.put("channelNo", channelNo);
        item.put("streamType", streamType);

        String camProvider = extra.path("provider").asText("").trim();
        if (camProvider.isBlank()) {
            camProvider = provider;
        }
        item.put("provider", camProvider);

        if ("ezviz".equalsIgnoreCase(camProvider) && !deviceSerial.isBlank()) {
            item.put("playUrl", "ezopen://open.ys7.com/" + deviceSerial + "/" + channelNo + ".live");
            item.put("hd", "main".equalsIgnoreCase(streamType));
        }
        String hlsUrl = extra.path("hlsUrl").asText("").trim();
        if (!hlsUrl.isBlank()) {
            item.put("hlsUrl", hlsUrl);
        } else if ("hls".equalsIgnoreCase(camProvider)) {
            item.put("hlsUrl", platform.path("hls").path("fallbackUrl").asText(""));
        }
        String zlmStream = extra.path("zlmStream").asText("").trim();
        if (!zlmStream.isBlank()) {
            String base = trimSlash(platform.path("zlm").path("baseUrl").asText(""));
            if (!base.isBlank()) {
                item.put("hlsUrl", base + "/live/" + zlmStream + "/hls.m3u8");
            }
        }
        if (accessToken != null) {
            item.put("canPlay", camEnabled && Boolean.TRUE.equals(cam.getOnline()));
        }
        return item;
    }

    private String resolveEzvizAccessToken(JsonNode platform) {
        if (cachedAccessToken != null && cachedTokenExpireAt != null
                && Instant.now().isBefore(cachedTokenExpireAt.minusSeconds(120))) {
            return cachedAccessToken;
        }
        return fetchEzvizToken(platform);
    }

    private String fetchEzvizToken(JsonNode platform) {
        String appKey = platform.path("ezviz").path("appKey").asText("").trim();
        String appSecret = platform.path("ezviz").path("appSecret").asText("").trim();
        if (appKey.isBlank() || appSecret.isBlank()) {
            throw new BizException("萤石 AppKey / AppSecret 未配置");
        }
        String domain = trimSlash(platform.path("ezviz").path("domain").asText("https://open.ys7.com"));
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("appKey", appKey);
        form.add("appSecret", appSecret);
        String body = restClient.post()
                .uri(domain + "/api/lapp/token/get")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(String.class);
        try {
            JsonNode json = objectMapper.readTree(body == null ? "{}" : body);
            String code = json.path("code").asText("");
            if (!"200".equals(code)) {
                throw new BizException("[" + code + "] " + json.path("msg").asText("获取 Token 失败"));
            }
            String token = json.path("data").path("accessToken").asText("");
            if (token.isBlank()) {
                throw new BizException("萤石返回空 Token");
            }
            long expireMs = json.path("data").path("expireTime").asLong(0);
            cachedAccessToken = token;
            cachedTokenExpireAt = expireMs > 0
                    ? Instant.ofEpochMilli(expireMs)
                    : Instant.now().plusSeconds(6 * 24 * 3600L);
            return token;
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException("解析萤石 Token 响应失败: " + e.getMessage());
        }
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

    private String previewToken(String token) {
        if (token == null || token.length() < 12) {
            return "—";
        }
        return token.substring(0, 8) + "…" + token.substring(token.length() - 4);
    }

    private String trimSlash(String url) {
        if (url == null) {
            return "";
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
