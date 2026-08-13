package com.anr.mineonemap.dashboard;

import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.domain.BizMapPoint;
import com.anr.mineonemap.domain.BizVideoCamera;
import com.anr.mineonemap.ingest.SensorViewService;
import com.anr.mineonemap.mapper.BizMapPointMapper;
import com.anr.mineonemap.mapper.BizVideoCameraMapper;
import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

@RestController
@RequestMapping("/api")
public class DashboardController {

    private final SensorViewService sensorViewService;
    private final CfgMapper cfgMapper;
    private final BizVideoCameraMapper videoCameraMapper;
    private final BizMapPointMapper mapPointMapper;
    private final ObjectMapper objectMapper;

    public DashboardController(SensorViewService sensorViewService, CfgMapper cfgMapper,
                                 BizVideoCameraMapper videoCameraMapper,
                                 BizMapPointMapper mapPointMapper,
                                 ObjectMapper objectMapper) {
        this.sensorViewService = sensorViewService;
        this.cfgMapper = cfgMapper;
        this.videoCameraMapper = videoCameraMapper;
        this.mapPointMapper = mapPointMapper;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/environment")
    public ApiResponse<JsonNode> environment() {
        return ApiResponse.ok(sensorViewService.buildEnvironment());
    }

    @GetMapping("/slope")
    public ApiResponse<JsonNode> slope() {
        return ApiResponse.ok(sensorViewService.buildSlope());
    }

    @GetMapping("/production")
    public ApiResponse<JsonNode> production() {
        return ApiResponse.ok(parsePayload(cfgMapper.getProductionPayload()));
    }

    @GetMapping("/video")
    public ApiResponse<Map<String, Object>> video() {
        List<BizVideoCamera> cameras = videoCameraMapper.listAll();
        return ApiResponse.ok(Map.of("cameras", cameras));
    }

    @GetMapping("/reserves")
    public ApiResponse<JsonNode> reserves() {
        return ApiResponse.ok(parsePayload(cfgMapper.getReservesPayload()));
    }

    /** 边坡/雨量地图点位元数据（库表 biz_map_point），不含演示 JSON 回退 */
    @GetMapping("/map-points")
    public ApiResponse<Map<String, Object>> mapPoints() {
        JsonNode mapCfg = parsePayload(cfgMapper.getMapPayload());
        List<BizMapPoint> rows = mapPointMapper.listAll();
        List<Map<String, Object>> points = new ArrayList<>();
        for (BizMapPoint p : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", p.getId());
            item.put("name", p.getName());
            item.put("type", p.getType());
            item.put("lng", p.getLng());
            item.put("lat", p.getLat());
            item.put("externalId", p.getExternalId());
            if (p.getExtra() != null && !p.getExtra().isBlank()) {
                try {
                    JsonNode extra = objectMapper.readTree(p.getExtra());
                    if (extra.isObject()) {
                        extra.fields().forEachRemaining(e -> item.putIfAbsent(e.getKey(),
                                objectMapper.convertValue(e.getValue(), Object.class)));
                    }
                } catch (Exception ignored) {
                    // keep base fields only
                }
            }
            points.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        if (mapCfg.has("mapCenter")) {
            result.put("mapCenter", objectMapper.convertValue(mapCfg.get("mapCenter"), Object.class));
        }
        if (mapCfg.has("mapZoom")) {
            result.put("mapZoom", mapCfg.get("mapZoom").asInt(15));
        }
        if (mapCfg.has("project")) {
            result.put("project", mapCfg.get("project").asText());
        }
        result.put("points", points);
        result.put("source", "database");
        return ApiResponse.ok(result);
    }

    @GetMapping("/alerts")
    public ApiResponse<List<Map<String, Object>>> alerts() {
        JsonNode env = sensorViewService.buildEnvironment();
        JsonNode slope = sensorViewService.buildSlope();
        JsonNode prod = parsePayload(cfgMapper.getProductionPayload());
        List<BizVideoCamera> cameras = videoCameraMapper.listAll();

        List<Map<String, Object>> alerts = new ArrayList<>();
        collectStatusAlerts(alerts, env, "environment");
        collectStatusAlerts(alerts, slope, "slope");
        collectStatusAlerts(alerts, prod, "production");
        for (BizVideoCamera cam : cameras) {
            if (Boolean.FALSE.equals(cam.getOnline())) {
                alerts.add(alert("video", cam.getId(), "offline", cam.getName() + " 离线"));
            }
        }
        return ApiResponse.ok(alerts);
    }

    @GetMapping("/sensors/latest")
    public ApiResponse<Map<String, JsonNode>> sensorsLatest() {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        result.put("environment", sensorViewService.buildEnvironment());
        result.put("slope", sensorViewService.buildSlope());
        result.put("status", sensorViewService.buildStatus());
        return ApiResponse.ok(result);
    }

    @GetMapping("/config/public")
    public ApiResponse<Map<String, Object>> publicConfig() {
        JsonNode mapCfg = parsePayload(cfgMapper.getMapPayload());
        JsonNode thresholds = parsePayload(cfgMapper.getEnvThresholdPayload());
        JsonNode sensorBridge = parsePayload(cfgMapper.getSensorBridgePayload());

        Map<String, Object> result = new LinkedHashMap<>();
        if (mapCfg.isObject()) {
            mapCfg.fields().forEachRemaining(entry ->
                    result.put(entry.getKey(), objectMapper.convertValue(entry.getValue(), Object.class)));
        }
        result.put("envThresholds", objectMapper.convertValue(thresholds, Object.class));
        int pollMs = 30000;
        if (sensorBridge.path("frontend").has("pollIntervalMs")) {
            pollMs = Math.max(30000, sensorBridge.path("frontend").path("pollIntervalMs").asInt(30000));
        }
        result.put("pollIntervalMs", pollMs);
        result.put("source", "database");
        return ApiResponse.ok(result);
    }

    private JsonNode parsePayload(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private void collectStatusAlerts(List<Map<String, Object>> alerts, JsonNode root, String source) {
        if (root == null || root.path("unavailable").asBoolean(false)) {
            return;
        }
        JsonNode points = root.get("points");
        if (points == null && root.isArray()) {
            points = root;
        }
        if (points == null || !points.isArray()) {
            if (root.has("status")) {
                addIfAbnormal(alerts, source, root.path("id").asText(source), root.get("status").asText(), root.path("name").asText(source));
            }
            return;
        }
        for (JsonNode point : points) {
            if (point.has("status")) {
                addIfAbnormal(alerts, source, point.path("id").asText("unknown"), point.get("status").asText(),
                        point.path("name").asText(point.path("id").asText("unknown")));
            }
        }
        if ("slope".equals(source) && root.has("rainfall") && root.get("rainfall").has("status")) {
            JsonNode rain = root.get("rainfall");
            addIfAbnormal(alerts, source, rain.path("id").asText("rainfall"), rain.get("status").asText(),
                    rain.path("name").asText("雨量"));
        }
    }

    private void addIfAbnormal(List<Map<String, Object>> alerts, String source, String id, String status, String name) {
        String normalized = status == null ? "" : status.toLowerCase(Locale.ROOT);
        if ("warn".equals(normalized) || "alarm".equals(normalized) || "fault".equals(normalized) || "offline".equals(normalized)) {
            alerts.add(alert(source, id, status, name + " " + status));
        }
    }

    private Map<String, Object> alert(String source, String id, String level, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", source);
        m.put("id", id);
        m.put("level", level);
        m.put("message", message);
        return m;
    }
}
