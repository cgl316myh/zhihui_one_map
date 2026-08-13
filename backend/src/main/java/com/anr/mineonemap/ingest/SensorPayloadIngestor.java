package com.anr.mineonemap.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 对标 sensor_bridge.gateway.ingest_payload：归一化 MQTT / HTTP JSON，并落库。
 * 兼容乙方 GNSS 字段 sn/baseX/baseY/baseZ/dateTime；可按 Topic 分流（…/gnss、…/YK）。
 */
@Component
public class SensorPayloadIngestor {

    private final SensorLatestStore store;
    private final SensorConfigService configService;
    private final SensorPersistService persistService;

    public SensorPayloadIngestor(SensorLatestStore store, SensorConfigService configService,
                                 SensorPersistService persistService) {
        this.store = store;
        this.configService = configService;
        this.persistService = persistService;
    }

    /** @return false 表示总开关关闭，未接收 */
    public boolean ingest(JsonNode root, String source) {
        return ingest(root, source, null);
    }

    public boolean ingest(JsonNode root, String source, String topic) {
        if (!configService.isIngestEnabled()) {
            return false;
        }
        if (root == null || root.isNull()) {
            return true;
        }
        if (root.isArray()) {
            for (JsonNode n : root) {
                if (n != null && n.isObject()) {
                    ingestObject(n, source, topic);
                }
            }
            return true;
        }
        if (root.isObject()) {
            ingestObject(root, source, topic);
        }
        return true;
    }

    private void ingestObject(JsonNode payload, String source, String topic) {
        String route = routeByTopic(topic);
        if ("gnss".equals(route)) {
            ingestGnss(payload, source, topic);
            return;
        }
        if ("rain".equals(route)) {
            ingestRain(payload, source, topic);
            return;
        }

        if (looksLikeHttpMeteo(payload) && !payload.has("deviceType")
                && !looksLikeGnss(payload) && !looksLikeRain(payload)) {
            ingestMeteo(payload, source, topic);
            return;
        }

        String deviceType = text(payload, "deviceType");
        String deviceSn = firstText(payload, "deviceSn", "sn");

        if ("2".equals(deviceType) || looksLikeGnss(payload)) {
            ingestGnss(payload, source, topic);
            return;
        }
        if (("".equals(deviceType) || "1".equals(deviceType) || "5".equals(deviceType))
                && looksLikeRain(payload)) {
            ingestRain(payload, source, topic);
            return;
        }
        if ("3".equals(deviceType) || "4".equals(deviceType) || "5".equals(deviceType)) {
            ingestOther(payload, source, topic);
            return;
        }
        if (!deviceSn.isEmpty() || payload.hasNonNull("clientId")) {
            ingestMeteo(payload, source, topic);
        }
    }

    /** Topic 名含 gnss → GNSS；含 YK → 雨量。 */
    static String routeByTopic(String topic) {
        if (topic == null || topic.isBlank()) {
            return "";
        }
        String t = topic.trim().toLowerCase(Locale.ROOT);
        if (t.endsWith("/gnss") || t.contains("/gnss/") || t.endsWith("gnss")) {
            return "gnss";
        }
        if (t.endsWith("/yk") || t.contains("/yk/") || t.endsWith("yk")) {
            return "rain";
        }
        return "";
    }

    private boolean looksLikeHttpMeteo(JsonNode p) {
        return p.has("ambientTemperature") || p.has("ambientHumidity") || p.has("ambientTemp")
                || p.has("clientId") || p.has("PM2.5") || p.has("PM10")
                || p.has("noise") || p.has("noise1");
    }

    private boolean looksLikeGnss(JsonNode p) {
        String sn = firstText(p, "deviceSn", "sn");
        if (sn.isEmpty()) {
            return false;
        }
        return hasAny(p, "x", "baseX") && hasAny(p, "y", "baseY");
    }

    private boolean looksLikeRain(JsonNode p) {
        return hasAny(p, "rainHour", "hourRain", "rainfallHour", "rain_1h",
                "rainDay", "dayRain", "rainfallDay", "rain_24h", "rainfall", "rain");
    }

    private void ingestGnss(JsonNode payload, String source, String topic) {
        String sn = firstText(payload, "deviceSn", "sn");
        if (sn.isEmpty()) {
            return;
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("collectTime", firstTextOrNull(payload, "collectTime", "dateTime", "time", "ts"));
        item.put("x", firstDouble(payload, 0.0, "x", "baseX"));
        item.put("y", firstDouble(payload, 0.0, "y", "baseY"));
        item.put("h", firstDouble(payload, 0.0, "z", "h", "baseZ", "height"));
        Double lon = firstDouble(payload, null, "lon", "longitude", "lng");
        Double lat = firstDouble(payload, null, "lat", "latitude");
        if (lon != null) {
            item.put("lon", lon);
        }
        if (lat != null) {
            item.put("lat", lat);
        }
        item.put("deviceType", firstNonBlank(text(payload, "deviceType"), "2"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putGnss(sn, item);
        persistService.persistAsync("gnss", sn, source, topic, item);
    }

    private void ingestRain(JsonNode payload, String source, String topic) {
        String sn = firstText(payload, "deviceSn", "sn", "deviceId", "id");
        if (sn.isEmpty()) {
            sn = "rain-unknown";
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("collectTime", firstTextOrNull(payload, "collectTime", "dateTime", "time", "ts"));
        item.put("rainHour", firstDouble(payload, 0.0,
                "rainHour", "hourRain", "rainfallHour", "rain_1h", "rain1h"));
        Double day = firstDouble(payload, null,
                "rainDay", "dayRain", "rainfallDay", "rain_24h", "rain24h", "rainfall", "rain");
        item.put("rainDay", day != null ? day : 0.0);
        item.put("errcode", payload.has("errcode") ? asJava(payload.get("errcode")) : 0);
        item.put("devChx", firstTextOrNull(payload, "devChx", "chx"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putRain(sn, item);
        persistService.persistAsync("rainfall", sn, source, topic, item);
    }

    private void ingestOther(JsonNode payload, String source, String topic) {
        String sn = firstNonBlank(firstText(payload, "deviceSn", "sn"), "unknown");
        String dtype = firstNonBlank(text(payload, "deviceType"), "other");
        String key = dtype + ":" + sn;
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("deviceType", dtype);
        item.put("collectTime", firstTextOrNull(payload, "collectTime", "dateTime"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putOther(key, item);
        persistService.persistAsync("other", key, source, topic, item);
    }

    private void ingestMeteo(JsonNode payload, String source, String topic) {
        String key = firstNonBlank(
                text(payload, "clientId"),
                firstText(payload, "deviceSn", "sn"),
                text(payload, "deviceId"),
                "meteo-default");
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", key);
        item.put("clientId", textOrNull(payload, "clientId"));
        item.put("deviceSn", firstTextOrNull(payload, "deviceSn", "sn"));
        String detected = firstNonBlank(
                text(payload, "detectedTime"),
                firstText(payload, "collectTime", "dateTime"));
        item.put("detectedTime", detected.isEmpty() ? null : detected);
        putMetric(item, "temperature", pick(payload, "ambientTemperature", "ambientTemp",
                "ambientTemperature1", "Airtemperature", "amt", "Temp"));
        putMetric(item, "humidity", pick(payload, "ambientHumidity", "ambientHum",
                "ambientHumidity1", "Airhumidity", "amh", "tambientHumidity"));
        putMetric(item, "noise", pick(payload, "noise", "noise1", "noi"));
        putMetric(item, "pm25", pick(payload, "PM2.5", "p25", "pm25"));
        putMetric(item, "pm10", pick(payload, "PM10", "p10", "pm10"));
        putMetric(item, "dust", pick(payload, "TSP", "dust"));
        putMetric(item, "pressure", pick(payload, "pressure", "pre"));
        putMetric(item, "windSpeed", pick(payload, "windSpeed", "wsp"));
        putMetric(item, "rainfall", pick(payload, "rainfall", "raininess"));
        putMetric(item, "lng", pick(payload, "longitude"));
        putMetric(item, "lat", pick(payload, "latitude"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putMeteo(key, item);
        persistService.persistAsync("meteo", key, source, topic, item);
    }

    private static void putMetric(Map<String, Object> item, String key, Double value) {
        if (value != null) {
            item.put(key, value);
        }
    }

    private static boolean hasAny(JsonNode payload, String... names) {
        for (String n : names) {
            if (payload.has(n) && !payload.get(n).isNull()) {
                return true;
            }
        }
        return false;
    }

    private static Double pick(JsonNode payload, String... names) {
        return firstDouble(payload, null, names);
    }

    private static Double firstDouble(JsonNode payload, Double defaultValue, String... names) {
        for (String n : names) {
            if (payload.has(n) && !payload.get(n).isNull()) {
                Double v = toDouble(payload.get(n), null);
                if (v != null) {
                    return v;
                }
            }
        }
        return defaultValue;
    }

    private static Double toDouble(JsonNode n, Double defaultValue) {
        if (n == null || n.isNull()) {
            return defaultValue;
        }
        if (n.isNumber()) {
            return n.asDouble();
        }
        try {
            String s = n.asText("").trim();
            if (s.isEmpty()) {
                return defaultValue;
            }
            return Double.parseDouble(s);
        } catch (Exception e) {
            return defaultValue;
        }
    }

    private static String text(JsonNode n, String field) {
        if (n == null || !n.has(field) || n.get(field).isNull()) {
            return "";
        }
        return n.get(field).asText("").trim();
    }

    private static String textOrNull(JsonNode n, String field) {
        String t = text(n, field);
        return t.isEmpty() ? null : t;
    }

    private static String firstText(JsonNode n, String... fields) {
        for (String f : fields) {
            String t = text(n, f);
            if (!t.isEmpty()) {
                return t;
            }
        }
        return "";
    }

    private static String firstTextOrNull(JsonNode n, String... fields) {
        String t = firstText(n, fields);
        return t.isEmpty() ? null : t;
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "";
    }

    private static Object asJava(JsonNode n) {
        if (n == null || n.isNull()) {
            return null;
        }
        if (n.isNumber()) {
            return n.isIntegralNumber() ? n.asLong() : n.asDouble();
        }
        if (n.isBoolean()) {
            return n.asBoolean();
        }
        return n.asText();
    }
}
