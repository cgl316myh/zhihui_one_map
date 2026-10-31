package com.anr.mineonemap.ingest.ftenv;

import com.anr.mineonemap.config.FtEnvProperties;
import com.anr.mineonemap.domain.CfgEnvStation;
import com.anr.mineonemap.ingest.SensorLatestStore;
import com.anr.mineonemap.ingest.SensorLatestStore;
import com.anr.mineonemap.ingest.SensorPersistService;
import com.anr.mineonemap.mapper.SensorPersistMapper;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class FtEnvPullService {

    private static final Logger log = LoggerFactory.getLogger(FtEnvPullService.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);
    public static final String SOURCE = "ftenv-pull";

    private static final Map<String, String> KEY_METRIC = Map.ofEntries(
            Map.entry("ambientTemperature", "temperature"),
            Map.entry("ambientHumidity", "humidity"),
            Map.entry("noise", "noise"),
            Map.entry("PM25", "pm25"),
            Map.entry("PM10", "pm10"),
            Map.entry("pressure", "pressure"),
            Map.entry("windSpeed", "windSpeed"),
            Map.entry("windDirection", "windDirection"),
            Map.entry("RSSI", "rssi"),
            Map.entry("WS", "avgWindSpeed")
    );

    private final FtEnvProperties props;
    private final FtEnvVendorClient client;
    private final SensorSchemaMapper schemaMapper;
    private final SensorPersistMapper tsMapper;
    private final SensorPersistService persistService;
    private final SensorLatestStore store;
    private final ObjectMapper objectMapper;

    public FtEnvPullService(FtEnvProperties props, FtEnvVendorClient client,
                            SensorSchemaMapper schemaMapper, SensorPersistMapper tsMapper,
                            SensorPersistService persistService, SensorLatestStore store,
                            ObjectMapper objectMapper) {
        this.props = props;
        this.client = client;
        this.schemaMapper = schemaMapper;
        this.tsMapper = tsMapper;
        this.persistService = persistService;
        this.store = store;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> pullOnce() {
        Map<String, Object> summary = new LinkedHashMap<>();
        int points = 0;
        int samples = 0;
        try {
            if (!props.isEnabled()) {
                throw new IllegalStateException("环境云平台拉取未启用");
            }
            if (!props.ready()) {
                throw new IllegalStateException("未配置环境云账号");
            }
            client.ensureToken();
            List<JsonNode> devices;
            try {
                devices = client.listDevices();
            } catch (IllegalStateException e) {
                if (e.getMessage() != null && e.getMessage().contains("未授权")) {
                    client.login();
                    devices = client.listDevices();
                } else {
                    throw e;
                }
            }

            OffsetDateTime lastOk = null;
            try {
                Map<String, Object> cursor = schemaMapper.getFtEnvPull();
                Object at = cursor == null ? null : cursor.get("lastSuccessAt");
                if (at instanceof OffsetDateTime odt) {
                    lastOk = odt;
                }
            } catch (Exception ignored) {
                /* first run */
            }

            long endMs = System.currentTimeMillis();
            long startMs;
            if (lastOk == null) {
                startMs = endMs - Math.max(2, props.getLookbackHours()) * 3600_000L;
            } else {
                startMs = lastOk.toInstant().toEpochMilli() - 2 * 3600_000L;
            }

            for (JsonNode d : devices) {
                String name = FtEnvVendorClient.text(d, "name");
                if (name.isEmpty()) {
                    name = d.path("id").path("id").asText("");
                }
                String deviceId = d.path("id").path("id").asText("");
                if (deviceId.isEmpty()) {
                    continue;
                }
                ensureStation(name, d.path("active").asBoolean(true));
                JsonNode latest = client.latestTimeseries(deviceId);
                ObjectNode payload = toMeteoPayload(name, latest);
                Map<String, Object> item = toItem(payload);
                persistService.persistSync("meteo", name, SOURCE, null, item);
                store.putMeteo(name, item);
                points++;

                JsonNode hist = client.historyTimeseries(deviceId, startMs, endMs);
                samples += persistHistory(name, hist);
            }

            OffsetDateTime now = OffsetDateTime.now(TZ8);
            schemaMapper.updateFtEnvPull(now, null, points, samples);
            summary.put("points", points);
            summary.put("samples", samples);
            summary.put("lastSuccessAt", now.toString());
            log.info("FT env pull points={} samples={}", points, samples);
            return summary;
        } catch (Exception e) {
            try {
                schemaMapper.updateFtEnvPull(null, e.getMessage(), points, samples);
            } catch (Exception ignored) {
                /* ignore */
            }
            throw e instanceof RuntimeException re ? re : new IllegalStateException(e.getMessage(), e);
        }
    }

    private void ensureStation(String name, boolean online) {
        try {
            CfgEnvStation st = new CfgEnvStation();
            st.setId(name);
            st.setName(name);
            st.setLocation(online ? "在线" : "离线");
            st.setClientId(name);
            st.setEnabled(true);
            st.setSortNo(0);
            schemaMapper.upsertEnvStationIgnore(st);
        } catch (Exception e) {
            log.warn("ensure station {}: {}", name, e.getMessage());
        }
    }

    private ObjectNode toMeteoPayload(String clientId, JsonNode ts) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("clientId", clientId);
        n.put("deviceSn", clientId);
        LatestPick pick = latestOf(ts);
        if (pick.ts > 0) {
            n.put("detectedTime", OffsetDateTime.ofInstant(Instant.ofEpochMilli(pick.ts), TZ8)
                    .toLocalDateTime().toString().replace('T', ' '));
        }
        putLatest(n, ts, "ambientTemperature");
        putLatest(n, ts, "ambientHumidity");
        putLatest(n, ts, "noise");
        if (ts.has("PM25")) {
            putLatestAs(n, ts, "PM25", "PM2.5");
            putLatestAs(n, ts, "PM25", "PM25");
        }
        putLatest(n, ts, "PM10");
        putLatest(n, ts, "pressure");
        putLatest(n, ts, "windSpeed");
        putLatest(n, ts, "windDirection");
        putLatest(n, ts, "RSSI");
        return n;
    }

    private Map<String, Object> toItem(ObjectNode payload) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", payload.path("clientId").asText());
        item.put("clientId", payload.path("clientId").asText());
        item.put("deviceSn", payload.path("deviceSn").asText());
        item.put("detectedTime", payload.path("detectedTime").asText(null));
        item.put("temperature", asD(payload, "ambientTemperature"));
        item.put("humidity", asD(payload, "ambientHumidity"));
        item.put("noise", asD(payload, "noise"));
        item.put("pm25", firstD(payload, "PM2.5", "PM25"));
        item.put("pm10", asD(payload, "PM10"));
        item.put("pressure", asD(payload, "pressure"));
        item.put("windSpeed", asD(payload, "windSpeed"));
        item.put("windDirection", asD(payload, "windDirection"));
        item.put("rssi", asD(payload, "RSSI"));
        item.put("receivedAt", OffsetDateTime.now(TZ8).toString());
        return item;
    }

    private int persistHistory(String clientId, JsonNode hist) {
        if (hist == null || !hist.isObject()) {
            return 0;
        }
        int n = 0;
        Iterator<Map.Entry<String, JsonNode>> it = hist.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String metric = KEY_METRIC.getOrDefault(e.getKey(), null);
            if (metric == null || !e.getValue().isArray()) {
                continue;
            }
            for (JsonNode row : e.getValue()) {
                Double v = toDouble(row.get("value"));
                long ts = row.path("ts").asLong(0);
                if (v == null || ts <= 0) {
                    continue;
                }
                OffsetDateTime at = OffsetDateTime.ofInstant(Instant.ofEpochMilli(ts), TZ8);
                n += tsMapper.insertEnvSample(clientId, metric, v, at);
            }
        }
        return n;
    }

    private static void putLatest(ObjectNode n, JsonNode ts, String key) {
        putLatestAs(n, ts, key, key);
    }

    private static void putLatestAs(ObjectNode n, JsonNode ts, String src, String dest) {
        JsonNode arr = ts.path(src);
        if (!arr.isArray() || arr.isEmpty()) {
            return;
        }
        JsonNode v = arr.get(0).path("value");
        if (v.isMissingNode() || v.isNull()) {
            return;
        }
        if (v.isNumber()) {
            n.put(dest, v.asDouble());
        } else {
            Double d = toDouble(v);
            if (d != null) {
                n.put(dest, d);
            }
        }
    }

    private static LatestPick latestOf(JsonNode ts) {
        LatestPick p = new LatestPick();
        if (ts == null || !ts.isObject()) {
            return p;
        }
        ts.fields().forEachRemaining(e -> {
            if (e.getValue().isArray() && !e.getValue().isEmpty()) {
                long t = e.getValue().get(0).path("ts").asLong(0);
                if (t > p.ts) {
                    p.ts = t;
                }
            }
        });
        return p;
    }

    private static Double asD(JsonNode n, String k) {
        return toDouble(n.get(k));
    }

    private static Double firstD(JsonNode n, String... keys) {
        for (String k : keys) {
            Double d = toDouble(n.get(k));
            if (d != null) {
                return d;
            }
        }
        return null;
    }

    private static Double toDouble(JsonNode n) {
        if (n == null || n.isMissingNode() || n.isNull()) {
            return null;
        }
        if (n.isNumber()) {
            return n.asDouble();
        }
        try {
            String s = n.asText("").trim();
            if (s.isEmpty() || "null".equalsIgnoreCase(s)) {
                return null;
            }
            return Double.parseDouble(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static final class LatestPick {
        long ts;
    }
}
