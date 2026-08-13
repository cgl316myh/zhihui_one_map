package com.anr.mineonemap.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 对标 sensor_bridge.gateway.ingest_payload：归一化 MQTT / HTTP JSON，并落库。
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
        if (looksLikeHttpMeteo(payload) && !payload.has("deviceType")) {
            ingestMeteo(payload, source, topic);
            return;
        }

        String deviceType = text(payload, "deviceType");
        String deviceSn = firstText(payload, "deviceSn", "sn");

        if ("2".equals(deviceType) || (payload.has("x") && payload.has("y") && !deviceSn.isEmpty())) {
            ingestGnss(payload, source, topic);
            return;
        }
        if (("".equals(deviceType) || "1".equals(deviceType) || "5".equals(deviceType))
                && (payload.has("rainHour") || payload.has("rainDay"))) {
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

    private boolean looksLikeHttpMeteo(JsonNode p) {
        return p.has("ambientTemperature") || p.has("ambientHumidity") || p.has("ambientTemp")
                || p.has("clientId") || p.has("PM2.5") || p.has("PM10")
                || p.has("noise") || p.has("noise1");
    }

    private void ingestGnss(JsonNode payload, String source, String topic) {
        String sn = text(payload, "deviceSn");
        if (sn.isEmpty()) {
            return;
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("collectTime", textOrNull(payload, "collectTime"));
        item.put("x", toDouble(payload.get("x"), 0.0));
        item.put("y", toDouble(payload.get("y"), 0.0));
        JsonNode hNode = payload.has("z") ? payload.get("z") : payload.get("h");
        item.put("h", toDouble(hNode, 0.0));
        item.put("deviceType", firstNonBlank(text(payload, "deviceType"), "2"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putGnss(sn, item);
        persistService.persistAsync("gnss", sn, source, topic, item);
    }

    private void ingestRain(JsonNode payload, String source, String topic) {
        String sn = text(payload, "deviceSn");
        if (sn.isEmpty()) {
            sn = "rain-unknown";
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("collectTime", textOrNull(payload, "collectTime"));
        item.put("rainHour", toDouble(payload.get("rainHour"), 0.0));
        item.put("rainDay", toDouble(payload.get("rainDay"), 0.0));
        item.put("errcode", payload.has("errcode") ? asJava(payload.get("errcode")) : 0);
        item.put("devChx", textOrNull(payload, "devChx"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putRain(sn, item);
        persistService.persistAsync("rainfall", sn, source, topic, item);
    }

    private void ingestOther(JsonNode payload, String source, String topic) {
        String sn = firstNonBlank(text(payload, "deviceSn"), "unknown");
        String dtype = firstNonBlank(text(payload, "deviceType"), "other");
        String key = dtype + ":" + sn;
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("deviceType", dtype);
        item.put("collectTime", textOrNull(payload, "collectTime"));
        item.put("source", source);
        item.put("topic", topic);
        item.put("receivedAt", SensorLatestStore.nowIso());
        store.putOther(key, item);
        persistService.persistAsync("other", key, source, topic, item);
    }

    private void ingestMeteo(JsonNode payload, String source, String topic) {
        String key = firstNonBlank(
                text(payload, "clientId"),
                text(payload, "deviceSn"),
                text(payload, "deviceId"),
                "meteo-default");
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", key);
        item.put("clientId", textOrNull(payload, "clientId"));
        item.put("deviceSn", textOrNull(payload, "deviceSn"));
        String detected = firstNonBlank(text(payload, "detectedTime"), text(payload, "collectTime"));
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

    private static Double pick(JsonNode payload, String... names) {
        for (String n : names) {
            if (payload.has(n) && !payload.get(n).isNull()) {
                return toDouble(payload.get(n), null);
            }
        }
        return null;
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
