package com.anr.mineonemap.ingest;

import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 模式 B：从云机拉取环境最新数据并 ingest。
 */
@Service
public class CloudRelayPullScheduler {

    private static final Logger log = LoggerFactory.getLogger(CloudRelayPullScheduler.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);

    private final SensorConfigService configService;
    private final SensorPayloadIngestor ingestor;
    private final SensorSchemaMapper schemaMapper;
    private final SensorLatestStore store;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private final AtomicReference<String> lastPullAt = new AtomicReference<>();
    private volatile long lastTickMs;

    public CloudRelayPullScheduler(SensorConfigService configService, SensorPayloadIngestor ingestor,
                                   SensorSchemaMapper schemaMapper, SensorLatestStore store,
                                   ObjectMapper objectMapper) {
        this.configService = configService;
        this.ingestor = ingestor;
        this.schemaMapper = schemaMapper;
        this.store = store;
        this.objectMapper = objectMapper;
    }

    @Scheduled(fixedDelayString = "15000")
    public void tick() {
        if (!configService.isIngestEnabled()) {
            return;
        }
        if (!"cloud_relay".equals(configService.httpMode())) {
            return;
        }
        JsonNode cloud = configService.getBridgeConfig().path("http").path("cloud");
        int intervalSec = Math.max(30, cloud.path("pullIntervalSec").asInt(30));
        long now = System.currentTimeMillis();
        if (now - lastTickMs < intervalSec * 1000L) {
            return;
        }
        lastTickMs = now;
        try {
            pullOnce(false);
        } catch (Exception e) {
            lastError.set(e.getMessage());
            schemaMapper.updateCloudPullCursor(schemaMapper.getCloudPullCursor(), e.getMessage());
            log.warn("cloud relay pull failed: {}", e.getMessage());
        }
    }

    /** @return 拉取并入库的条数 */
    public int pullOnce(boolean forceBackfill) throws Exception {
        JsonNode http = configService.getBridgeConfig().path("http");
        JsonNode cloud = http.path("cloud");
        String base = cloud.path("baseUrl").asText("").trim().replaceAll("/+$", "");
        if (base.isEmpty()) {
            throw new IllegalStateException("cloud.baseUrl 未配置");
        }
        boolean backfill = forceBackfill || cloud.path("backfillEnabled").asBoolean(true);
        String path;
        OffsetDateTime cursor = schemaMapper.getCloudPullCursor();
        if (backfill && cursor != null) {
            path = cloud.path("sincePath").asText("/api/relay/since");
            String t = cursor.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            path = path + (path.contains("?") ? "&" : "?") + "t=" + java.net.URLEncoder.encode(t, java.nio.charset.StandardCharsets.UTF_8);
        } else {
            path = cloud.path("pullPath").asText("/api/relay/latest");
        }
        String url = base + (path.startsWith("/") ? path : "/" + path);
        HttpHeaders headers = new HttpHeaders();
        String token = cloud.path("token").asText("").trim();
        if (!token.isEmpty()) {
            headers.setBearerAuth(token);
        }
        ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET,
                new HttpEntity<>(headers), String.class);
        String body = resp.getBody() == null ? "[]" : resp.getBody();
        JsonNode node = objectMapper.readTree(body);
        int n = 0;
        if (node.isArray()) {
            for (JsonNode item : node) {
                if (item != null && item.isObject()) {
                    if (ingestor.ingest(item, "cloud-pull")) {
                        n++;
                    }
                }
            }
        } else if (node.isObject()) {
            if (node.has("items") && node.get("items").isArray()) {
                for (JsonNode item : node.get("items")) {
                    if (item != null && item.isObject() && ingestor.ingest(item, "cloud-pull")) {
                        n++;
                    }
                }
            } else if (ingestor.ingest(node, "cloud-pull")) {
                n++;
            }
        }
        OffsetDateTime now = OffsetDateTime.now(TZ8);
        schemaMapper.updateCloudPullCursor(now, null);
        lastPullAt.set(now.toString());
        lastError.set(null);
        store.setCloudPullLastAt(now.toString());
        store.setCloudPullError(null);
        log.info("cloud relay pulled {} item(s) from {}", n, url);
        return n;
    }

    public String getLastError() {
        return lastError.get();
    }

    public String getLastPullAt() {
        return lastPullAt.get();
    }

    public JsonNode cloudHealth() {
        JsonNode cloud = configService.getBridgeConfig().path("http").path("cloud");
        String base = cloud.path("baseUrl").asText("").trim().replaceAll("/+$", "");
        ObjectMapper om = objectMapper;
        var out = om.createObjectNode();
        out.put("baseUrl", base);
        if (base.isEmpty()) {
            out.put("ok", false);
            out.put("message", "baseUrl empty");
            return out;
        }
        try {
            String url = base + "/api/relay/health";
            HttpHeaders headers = new HttpHeaders();
            String token = cloud.path("token").asText("").trim();
            if (!token.isEmpty()) {
                headers.setBearerAuth(token);
            }
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET,
                    new HttpEntity<>(headers), String.class);
            out.put("ok", resp.getStatusCode().is2xxSuccessful());
            out.put("status", resp.getStatusCode().value());
            out.put("body", resp.getBody());
        } catch (Exception e) {
            out.put("ok", false);
            out.put("message", e.getMessage());
        }
        return out;
    }
}
