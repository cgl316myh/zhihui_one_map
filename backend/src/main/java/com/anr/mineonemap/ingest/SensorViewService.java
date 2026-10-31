package com.anr.mineonemap.ingest;

import com.anr.mineonemap.domain.BizBdlxAlarm;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * 组装 /api/environment、/api/slope、/api/status（对标 gateway build_*）。
 */
@Service
public class SensorViewService {

    private final SensorLatestStore store;
    private final SensorConfigService configService;
    private final SensorSchemaMapper schemaMapper;
    private final ObjectMapper objectMapper;

    public SensorViewService(SensorLatestStore store, SensorConfigService configService,
                             SensorSchemaMapper schemaMapper, ObjectMapper objectMapper) {
        this.store = store;
        this.configService = configService;
        this.schemaMapper = schemaMapper;
        this.objectMapper = objectMapper;
    }

    public JsonNode buildEnvironment() {
        JsonNode cfg = configService.getConfig();
        Map<String, Map<String, Object>> meteo = store.snapshotMeteo();
        List<Map<String, Object>> unused = new ArrayList<>(meteo.values());
        unused.sort((a, b) -> String.valueOf(b.getOrDefault("receivedAt", ""))
                .compareTo(String.valueOf(a.getOrDefault("receivedAt", ""))));

        ArrayNode points = objectMapper.createArrayNode();
        Set<Object> usedKeys = new HashSet<>();
        JsonNode stations = cfg.path("environmentStations");
        if (stations.isArray()) {
            for (JsonNode st : stations) {
                Map<String, Object> matched = matchMeteo(st, meteo, unused, usedKeys);
                if (matched != null) {
                    usedKeys.add(matched.get("id"));
                    points.add(envPointFromMatch(st, matched, cfg));
                } else {
                    points.add(envOfflineShell(st));
                }
            }
        }

        boolean anyMetrics = false;
        for (JsonNode p : points) {
            if (p.path("metrics").size() > 0) {
                anyMetrics = true;
                break;
            }
        }
        if (!meteo.isEmpty() && !anyMetrics) {
            points = objectMapper.createArrayNode();
            int i = 0;
            for (Map.Entry<String, Map<String, Object>> e : meteo.entrySet()) {
                if (i >= 3) {
                    break;
                }
                points.add(envSynthesized(i + 1, e.getKey(), e.getValue(), cfg));
                i++;
            }
            anyMetrics = points.size() > 0;
            for (JsonNode p : points) {
                if (p.path("metrics").size() > 0) {
                    anyMetrics = true;
                    break;
                }
            }
        }

        ObjectNode out = objectMapper.createObjectNode();
        out.put("updatedAt", SensorLatestStore.nowIso());
        out.put("live", anyMetrics);
        out.put("source", anyMetrics ? "spring-ingest" : "bridge-no-data");
        out.set("points", points);
        return out;
    }

    public JsonNode buildSlope() {
        JsonNode cfg = configService.getConfig();
        Map<String, Map<String, Object>> gnss = store.snapshotGnss();
        Map<String, Map<String, Object>> rains = store.snapshotRainfall();
        JsonNode mapping = cfg.path("slopeDevices");

        ArrayNode points = objectMapper.createArrayNode();
        if (mapping.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = mapping.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                String sn = e.getKey();
                JsonNode meta = e.getValue();
                if (!"displacement".equals(meta.path("type").asText())) {
                    continue;
                }
                Map<String, Object> g = gnss.get(sn);
                if (g == null) {
                    continue;
                }
                points.add(slopePoint(meta.path("id").asText(sn), meta.path("name").asText(sn), sn, g));
            }
        }
        for (Map.Entry<String, Map<String, Object>> e : gnss.entrySet()) {
            if (mapping.has(e.getKey())) {
                continue;
            }
            points.add(slopePoint(e.getKey(), e.getKey(), e.getKey(), e.getValue()));
        }

        ObjectNode rainfall = null;
        String rainSn = null;
        JsonNode rainMeta = null;
        if (mapping.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = mapping.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                if ("rainfall".equals(e.getValue().path("type").asText())) {
                    rainSn = e.getKey();
                    rainMeta = e.getValue();
                    break;
                }
            }
        }
        Map<String, Object> rainItem = rainSn != null ? rains.get(rainSn) : null;
        if (rainItem == null && !rains.isEmpty()) {
            Map.Entry<String, Map<String, Object>> first = rains.entrySet().iterator().next();
            rainSn = first.getKey();
            rainItem = first.getValue();
        }
        if (rainItem != null) {
            rainfall = objectMapper.createObjectNode();
            rainfall.put("id", rainMeta != null ? rainMeta.path("id").asText(rainSn) : rainSn);
            rainfall.put("name", rainMeta != null ? rainMeta.path("name").asText("雨量") : "雨量");
            putNum(rainfall, "valueMm", rainItem.get("rainHour"));
            putNum(rainfall, "cumulativeMm", rainItem.get("rainDay"));
            rainfall.putNull("yl24h");
            Object err = rainItem.get("errcode");
            boolean alarm = err != null && !"0".equals(String.valueOf(err)) && !Integer.valueOf(0).equals(err)
                    && !(err instanceof Number && ((Number) err).intValue() == 0);
            rainfall.put("status", rainStatus(rainItem, alarm));
            rainfall.put("unit", "mm");
            putBool(rainfall, "online", rainItem.get("online"));
            if (rainItem.get("maintainer") != null) {
                rainfall.put("maintainer", String.valueOf(rainItem.get("maintainer")));
            }
            Object upd = rainItem.get("collectTime") != null ? rainItem.get("collectTime") : rainItem.get("receivedAt");
            rainfall.put("updatedAt", upd == null ? null : String.valueOf(upd));
            rainfall.set("series", objectMapper.createArrayNode());
        }

        boolean live = points.size() > 0 || rainfall != null;
        ObjectNode out = objectMapper.createObjectNode();
        out.put("updatedAt", SensorLatestStore.nowIso());
        out.put("live", live);
        String src = live ? (anyBdlx(gnss, rains) ? "bdlx-hourly" : "spring-ingest-mqtt") : "bridge-no-data";
        out.put("source", src);
        out.put("sourceUrl", "http://bdlx.jgtop1.com/");
        out.put("projectName", "安宁隆瑞边坡位移监控");
        out.set("alarms", vendorAlarmsNode());
        if (rainfall != null) {
            out.set("rainfall", rainfall);
        } else {
            out.putNull("rainfall");
        }
        out.set("points", points);
        return out;
    }

    public JsonNode buildStatus() {
        JsonNode cfg = configService.getConfig();
        ObjectNode out = objectMapper.createObjectNode();
        out.put("updatedAt", store.getUpdatedAt());
        ObjectNode mqtt = objectMapper.createObjectNode();
        mqtt.put("connected", store.isMqttConnected());
        mqtt.put("lastMessageAt", store.getMqttLastMessageAt());
        mqtt.put("topic", store.getMqttTopic());
        mqtt.put("error", store.getMqttError());
        out.set("mqtt", mqtt);
        ObjectNode http = objectMapper.createObjectNode();
        http.put("lastReceiveAt", store.getHttpLastReceiveAt());
        http.put("count", store.getHttpCount());
        http.put("mode", cfg.path("http").path("mode").asText("direct"));
        String base = cfg.path("http").path("publicBaseUrl").asText("").replaceAll("/+$", "");
        String path = cfg.path("http").path("pushPath").asText("/api/push");
        http.put("publicPushUrl", base.isEmpty() ? path : base + path);
        out.set("httpPush", http);
        ObjectNode cloud = objectMapper.createObjectNode();
        cloud.put("lastPullAt", store.getCloudPullLastAt());
        cloud.put("error", store.getCloudPullError());
        cloud.put("baseUrl", cfg.path("http").path("cloud").path("baseUrl").asText(""));
        out.set("cloudRelay", cloud);
        ObjectNode bdlx = objectMapper.createObjectNode();
        bdlx.put("lastPullAt", store.getBdlxPullLastAt());
        bdlx.put("error", store.getBdlxPullError());
        try {
            Map<String, Object> cursor = schemaMapper.getBdlxPull();
            if (cursor != null) {
                Object succ = cursor.get("lastSuccessAt");
                if (succ != null) {
                    bdlx.put("lastSuccessAt", String.valueOf(succ));
                }
                Object err = cursor.get("lastError");
                if (err != null) {
                    bdlx.put("lastError", String.valueOf(err));
                }
            }
        } catch (Exception ignored) {
        }
        out.set("bdlx", bdlx);
        ObjectNode counts = objectMapper.createObjectNode();
        counts.put("gnss", store.snapshotGnss().size());
        counts.put("rainfall", store.snapshotRainfall().size());
        counts.put("meteo", store.snapshotMeteo().size());
        counts.put("other", store.snapshotOther().size());
        out.set("counts", counts);
        out.put("pollHintSec", Math.max(30, cfg.path("pollHintSec").asInt(30)));
        out.put("mqttKeepaliveSec", Math.max(30, cfg.path("mqtt").path("keepalive").asInt(60)));
        out.put("reconnectDelaySec", Math.max(30, cfg.path("mqtt").path("reconnectDelaySec").asInt(30)));
        out.put("engine", "spring-boot");
        ObjectNode ingest = objectMapper.createObjectNode();
        ingest.put("enabled", cfg.path("ingest").path("enabled").asBoolean(true));
        ingest.put("demoPushEnabled", cfg.path("ingest").path("demoPushEnabled").asBoolean(false));
        ingest.put("demoPushIntervalSec", Math.max(30, cfg.path("ingest").path("demoPushIntervalSec").asInt(30)));
        out.set("ingest", ingest);
        return out;
    }

    private Map<String, Object> matchMeteo(JsonNode st, Map<String, Map<String, Object>> meteo,
                                           List<Map<String, Object>> unused, Set<Object> usedKeys) {
        JsonNode clientIds = st.path("clientIds");
        if (clientIds.isArray()) {
            for (JsonNode c : clientIds) {
                Map<String, Object> m = meteo.get(c.asText());
                if (m != null) {
                    return m;
                }
            }
        }
        JsonNode deviceSns = st.path("deviceSns");
        if (deviceSns.isArray()) {
            for (JsonNode snNode : deviceSns) {
                String sn = snNode.asText();
                if (meteo.containsKey(sn)) {
                    return meteo.get(sn);
                }
                for (Map<String, Object> v : meteo.values()) {
                    if (sn.equals(String.valueOf(v.getOrDefault("deviceSn", "")))) {
                        return v;
                    }
                }
            }
        }
        for (Map<String, Object> v : unused) {
            Object k = v.get("id");
            if (!usedKeys.contains(k)) {
                return v;
            }
        }
        return null;
    }

    private ObjectNode envPointFromMatch(JsonNode st, Map<String, Object> matched, JsonNode cfg) {
        ObjectNode metrics = objectMapper.createObjectNode();
        ObjectNode units = objectMapper.createObjectNode();
        putMetricPair(metrics, units, matched, "temperature", "℃");
        putMetricPair(metrics, units, matched, "humidity", "%");
        putMetricPair(metrics, units, matched, "noise", "dB");
        putMetricPair(metrics, units, matched, "pm25", "μg/m³");
        putMetricPair(metrics, units, matched, "pm10", "μg/m³");
        putMetricPair(metrics, units, matched, "dust", "μg/m³");

        ObjectNode p = objectMapper.createObjectNode();
        p.put("id", st.path("id").asText());
        p.put("name", st.path("name").asText(st.path("id").asText()));
        p.put("location", st.path("location").asText(""));
        Object lng = matched.get("lng") != null ? matched.get("lng") : asDouble(st.get("lng"));
        Object lat = matched.get("lat") != null ? matched.get("lat") : asDouble(st.get("lat"));
        putNum(p, "lng", lng);
        putNum(p, "lat", lat);
        p.put("status", envStatus(metrics, cfg));
        p.set("metrics", metrics);
        p.set("units", units);
        p.put("source", matched.get("source") == null ? null : String.valueOf(matched.get("source")));
        p.put("detectedTime", matched.get("detectedTime") == null ? null : String.valueOf(matched.get("detectedTime")));
        p.put("sensorKey", matched.get("id") == null ? null : String.valueOf(matched.get("id")));
        return p;
    }

    private ObjectNode envOfflineShell(JsonNode st) {
        ObjectNode p = objectMapper.createObjectNode();
        p.put("id", st.path("id").asText());
        p.put("name", st.path("name").asText(st.path("id").asText()));
        p.put("location", st.path("location").asText(""));
        putNum(p, "lng", asDouble(st.get("lng")));
        putNum(p, "lat", asDouble(st.get("lat")));
        p.put("status", "offline");
        p.set("metrics", objectMapper.createObjectNode());
        p.set("units", objectMapper.createObjectNode());
        p.putNull("source");
        p.putNull("detectedTime");
        p.putNull("sensorKey");
        return p;
    }

    private ObjectNode envSynthesized(int index, String key, Map<String, Object> m, JsonNode cfg) {
        ObjectNode metrics = objectMapper.createObjectNode();
        ObjectNode units = objectMapper.createObjectNode();
        putMetricPair(metrics, units, m, "temperature", "℃");
        putMetricPair(metrics, units, m, "humidity", "%");
        putMetricPair(metrics, units, m, "noise", "dB");
        putMetricPair(metrics, units, m, "pm25", "μg/m³");
        putMetricPair(metrics, units, m, "pm10", "μg/m³");
        ObjectNode p = objectMapper.createObjectNode();
        p.put("id", String.format("ENV-%02d", index));
        p.put("name", "环境监测 · " + (key.length() > 8 ? key.substring(0, 8) : key));
        p.put("location", "传感器推送");
        putNum(p, "lng", m.get("lng") != null ? m.get("lng") : 102.446);
        putNum(p, "lat", m.get("lat") != null ? m.get("lat") : 24.787);
        p.put("status", envStatus(metrics, cfg));
        p.set("metrics", metrics);
        p.set("units", units);
        p.put("source", m.get("source") == null ? null : String.valueOf(m.get("source")));
        p.put("detectedTime", m.get("detectedTime") == null ? null : String.valueOf(m.get("detectedTime")));
        p.put("sensorKey", key);
        return p;
    }

    private ObjectNode slopePoint(String id, String name, String sn, Map<String, Object> g) {
        ObjectNode p = objectMapper.createObjectNode();
        p.put("id", id);
        p.put("name", name);
        p.put("sn", sn);
        putNum(p, "x", g.get("x"));
        putNum(p, "y", g.get("y"));
        putNum(p, "h", g.get("h"));
        putNum(p, "plane", g.get("plane"));
        putNum(p, "planeSpeed", g.get("planeSpeed"));
        putNum(p, "planeAcc", g.get("planeAcc"));
        putNum(p, "azimuth", g.get("azimuth"));
        putNum(p, "totalProjection", g.get("totalProjection"));
        putNum(p, "speedX", g.get("speedX"));
        putNum(p, "speedY", g.get("speedY"));
        putNum(p, "speedH", g.get("speedH"));
        putNum(p, "projectionSpeed", g.get("projectionSpeed"));
        putNum(p, "projectionAcc", g.get("projectionAcc"));
        putNum(p, "intervalHours", g.get("intervalHours"));
        putNum(p, "lng", g.get("lon") != null ? g.get("lon") : g.get("lng"));
        putNum(p, "lat", g.get("lat"));
        p.put("unit", "mm");
        String vendorColor = g.get("vendorColor") == null ? "" : String.valueOf(g.get("vendorColor"));
        if (!vendorColor.isBlank()) {
            p.put("vendorColor", vendorColor);
        }
        if (g.get("alarmText") != null) {
            p.put("alarmText", String.valueOf(g.get("alarmText")));
        }
        if (g.get("maintainer") != null) {
            p.put("maintainer", String.valueOf(g.get("maintainer")));
        }
        putBool(p, "online", g.get("online"));
        p.put("status", slopeStatus(g, vendorColor));
        ObjectNode th = objectMapper.createObjectNode();
        th.put("warn", 20);
        th.put("alarm", 80);
        p.set("threshold", th);
        Object upd = g.get("collectTime") != null ? g.get("collectTime") : g.get("receivedAt");
        p.put("updatedAt", upd == null ? null : String.valueOf(upd));
        p.set("series", objectMapper.createArrayNode());
        return p;
    }

    private ArrayNode vendorAlarmsNode() {
        ArrayNode arr = objectMapper.createArrayNode();
        try {
            List<BizBdlxAlarm> rows = schemaMapper.listBdlxAlarms();
            if (rows == null) {
                return arr;
            }
            for (BizBdlxAlarm a : rows) {
                ObjectNode n = objectMapper.createObjectNode();
                n.put("id", a.getVendorId() == null ? null : String.valueOf(a.getVendorId()));
                n.put("pointId", a.getPointId());
                n.put("deviceSn", a.getDeviceSn());
                n.put("color", a.getColor());
                n.put("level", a.getLevel() == null ? "info" : a.getLevel());
                n.put("module", "边坡预警");
                n.put("title", a.getTitle() == null || a.getTitle().isBlank() ? a.getContent() : a.getTitle());
                n.put("time", a.getAlarmTime() == null ? null : a.getAlarmTime().toString());
                n.put("status", a.getStatus());
                arr.add(n);
            }
        } catch (Exception ignored) {
        }
        return arr;
    }

    private static boolean anyBdlx(Map<String, Map<String, Object>> gnss, Map<String, Map<String, Object>> rains) {
        for (Map<String, Object> m : gnss.values()) {
            if ("bdlx-pull".equals(String.valueOf(m.get("source")))) {
                return true;
            }
        }
        for (Map<String, Object> m : rains.values()) {
            if ("bdlx-pull".equals(String.valueOf(m.get("source")))) {
                return true;
            }
        }
        return false;
    }

    private static String slopeStatus(Map<String, Object> g, String vendorColor) {
        if (Boolean.FALSE.equals(g.get("online"))) {
            return "offline";
        }
        if ("red".equals(vendorColor)) {
            return "alarm";
        }
        if ("orange".equals(vendorColor) || "yellow".equals(vendorColor)) {
            return "warn";
        }
        return "normal";
    }

    private static String rainStatus(Map<String, Object> rainItem, boolean alarm) {
        if (Boolean.FALSE.equals(rainItem.get("online"))) {
            return "offline";
        }
        return alarm ? "alarm" : "normal";
    }

    private void putMetricPair(ObjectNode metrics, ObjectNode units, Map<String, Object> src, String key, String unit) {
        Object v = src.get(key);
        if (v instanceof Number) {
            metrics.put(key, ((Number) v).doubleValue());
            units.put(key, unit);
        }
    }

    private String envStatus(ObjectNode metrics, JsonNode cfg) {
        JsonNode th = cfg.path("thresholds");
        if (metrics.has("noise")) {
            boolean night = isNight();
            double limit = night ? th.path("noiseNight").asDouble(50) : th.path("noiseDay").asDouble(60);
            if (metrics.get("noise").asDouble() > limit) {
                return "alarm";
            }
        }
        if (metrics.has("pm25") && th.has("pm25") && metrics.get("pm25").asDouble() > th.get("pm25").asDouble()) {
            return "warn";
        }
        if (metrics.has("pm10") && th.has("pm10") && metrics.get("pm10").asDouble() > th.get("pm10").asDouble()) {
            return "warn";
        }
        return "normal";
    }

    private static boolean isNight() {
        int hour = OffsetDateTime.now(SensorLatestStore.TZ8).getHour();
        return hour >= 22 || hour < 6;
    }

    private static void putBool(ObjectNode node, String field, Object value) {
        if (value instanceof Boolean b) {
            node.put(field, b);
        }
    }

    private static void putNum(ObjectNode node, String field, Object value) {
        if (value == null) {
            node.putNull(field);
            return;
        }
        if (value instanceof Number) {
            node.put(field, ((Number) value).doubleValue());
            return;
        }
        try {
            node.put(field, Double.parseDouble(String.valueOf(value)));
        } catch (Exception e) {
            node.putNull(field);
        }
    }

    private static Double asDouble(JsonNode n) {
        if (n == null || n.isNull()) {
            return null;
        }
        if (n.isNumber()) {
            return n.asDouble();
        }
        try {
            return Double.parseDouble(n.asText());
        } catch (Exception e) {
            return null;
        }
    }
}
