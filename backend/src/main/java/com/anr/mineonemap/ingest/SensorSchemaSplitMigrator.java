package com.anr.mineonemap.ingest;

import com.anr.mineonemap.domain.*;
import com.anr.mineonemap.mapper.CfgMapper;
import com.anr.mineonemap.mapper.SensorPersistMapper;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 一次性：从旧 bridge JSON / biz_sensor_latest JSONB 迁移到列式表，并瘦身 bridge。
 */
@Component
@Order(40)
public class SensorSchemaSplitMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SensorSchemaSplitMigrator.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);
    private static final DateTimeFormatter LOCAL_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final CfgMapper cfgMapper;
    private final SensorSchemaMapper schemaMapper;
    private final SensorPersistMapper persistMapper;
    private final ObjectMapper objectMapper;

    public SensorSchemaSplitMigrator(CfgMapper cfgMapper, SensorSchemaMapper schemaMapper,
                                     SensorPersistMapper persistMapper, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.schemaMapper = schemaMapper;
        this.persistMapper = persistMapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            JsonNode bridge = parse(cfgMapper.getSensorBridgePayload());
            migrateIngest(bridge);
            migrateStations(bridge);
            migrateSlopeDevices(bridge);
            migrateThresholds(bridge);
            migrateLatestFromJsonBlob();
            slimBridge(bridge);
            log.info("Sensor schema split migrate done");
        } catch (Exception e) {
            log.warn("Sensor schema split migrate failed: {}", e.getMessage());
        }
    }

    private void migrateIngest(JsonNode bridge) {
        CfgSensorIngest cur = schemaMapper.getIngest();
        if (cur == null) {
            return;
        }
        JsonNode ingest = bridge.path("ingest");
        if (!ingest.isObject()) {
            return;
        }
        // 仅当仍是默认且 JSON 有值时覆盖一次：用 JSON 为准
        cur.setEnabled(ingest.path("enabled").asBoolean(true));
        cur.setDemoPushEnabled(ingest.path("demoPushEnabled").asBoolean(false));
        cur.setDemoPushIntervalSec(Math.max(30, ingest.path("demoPushIntervalSec").asInt(30)));
        if (bridge.path("envRetention").path("months").isNumber()) {
            cur.setEnvRetentionMonths(Math.max(1, bridge.path("envRetention").path("months").asInt(3)));
        }
        cur.setUpdatedBy("migrate");
        schemaMapper.updateIngest(cur);
    }

    private void migrateStations(JsonNode bridge) {
        if (schemaMapper.countStations() > 0) {
            return;
        }
        JsonNode stations = bridge.path("environmentStations");
        if (!stations.isArray() || stations.isEmpty()) {
            stations = loadMappingSeed().path("environmentStations");
        }
        if (!stations.isArray()) {
            return;
        }
        int i = 0;
        for (JsonNode st : stations) {
            CfgEnvStation row = new CfgEnvStation();
            row.setId(st.path("id").asText("ENV-" + (++i)));
            row.setName(st.path("name").asText(row.getId()));
            row.setLocation(st.path("location").asText(null));
            if (st.path("lng").isNumber()) {
                row.setLng(st.path("lng").asDouble());
            }
            if (st.path("lat").isNumber()) {
                row.setLat(st.path("lat").asDouble());
            }
            String clientId = null;
            JsonNode ids = st.path("clientIds");
            if (ids.isArray() && !ids.isEmpty()) {
                clientId = ids.get(0).asText(null);
            }
            row.setClientId(clientId);
            row.setEnabled(true);
            row.setSortNo(i);
            schemaMapper.insertStation(row);
        }
        log.info("Migrated {} env stations", schemaMapper.countStations());
    }

    private void migrateSlopeDevices(JsonNode bridge) {
        if (schemaMapper.countSlopeDevices() > 0) {
            return;
        }
        JsonNode mapping = bridge.path("slopeDevices");
        if (!mapping.isObject() || mapping.isEmpty()) {
            mapping = loadMappingSeed().path("slopeDevices");
        }
        if (!mapping.isObject()) {
            return;
        }
        int i = 0;
        Iterator<Map.Entry<String, JsonNode>> it = mapping.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            CfgSlopeDevice row = new CfgSlopeDevice();
            row.setDeviceSn(e.getKey());
            row.setExternalId(e.getValue().path("id").asText(null));
            row.setName(e.getValue().path("name").asText(e.getKey()));
            row.setDeviceKind(e.getValue().path("type").asText("displacement"));
            row.setEnabled(true);
            row.setSortNo(++i);
            schemaMapper.insertSlopeDevice(row);
        }
        log.info("Migrated {} slope devices", schemaMapper.countSlopeDevices());
    }

    private void migrateThresholds(JsonNode bridge) {
        JsonNode th = bridge.path("thresholds");
        if (!th.isObject()) {
            th = loadMappingSeed().path("thresholds");
        }
        if (!th.isObject()) {
            return;
        }
        schemaMapper.updateSensorThreshold(
                th.path("noiseDay").asDouble(60),
                th.path("noiseNight").asDouble(50),
                th.path("pm25").asDouble(75),
                th.path("pm10").asDouble(150));
    }

    private void migrateLatestFromJsonBlob() {
        if (schemaMapper.countEnvLatest() > 0) {
            return;
        }
        List<BizSensorLatest> rows;
        try {
            rows = persistMapper.listAllLatest();
        } catch (Exception e) {
            return;
        }
        if (rows == null || rows.isEmpty()) {
            return;
        }
        int n = 0;
        for (BizSensorLatest row : rows) {
            try {
                JsonNode p = objectMapper.readTree(row.getPayload() == null ? "{}" : row.getPayload());
                OffsetDateTime received = row.getReceivedAt() != null ? row.getReceivedAt() : OffsetDateTime.now(TZ8);
                String source = row.getSource() == null ? "migrate" : row.getSource();
                String topic = row.getTopic();
                switch (row.getCategory()) {
                    case "meteo" -> {
                        BizEnvLatest env = new BizEnvLatest();
                        env.setClientId(row.getSensorKey());
                        env.setDetectedTime(parseTime(p.path("detectedTime").asText(null)));
                        env.setAmbientTemperature(num(p, "temperature"));
                        env.setAmbientHumidity(num(p, "humidity"));
                        env.setNoise(num(p, "noise"));
                        env.setPm25(num(p, "pm25"));
                        env.setPm10(num(p, "pm10"));
                        env.setTsp(num(p, "dust"));
                        env.setPressure(num(p, "pressure"));
                        env.setWindSpeed(num(p, "windSpeed"));
                        env.setRainfall(num(p, "rainfall"));
                        env.setLongitude(num(p, "lng"));
                        env.setLatitude(num(p, "lat"));
                        env.setSource(source);
                        env.setTopic(topic);
                        env.setReceivedAt(received);
                        schemaMapper.upsertEnvLatest(env);
                        n++;
                    }
                    case "gnss" -> {
                        BizSlopeLatest s = new BizSlopeLatest();
                        s.setDeviceSn(row.getSensorKey());
                        s.setCollectTime(parseTime(p.path("collectTime").asText(null)));
                        s.setXMm(num(p, "x"));
                        s.setYMm(num(p, "y"));
                        s.setHMm(num(p, "h"));
                        s.setDeviceType(p.path("deviceType").asText("2"));
                        s.setSource(source);
                        s.setTopic(topic);
                        s.setReceivedAt(received);
                        schemaMapper.upsertSlopeLatest(s);
                        n++;
                    }
                    case "rainfall" -> {
                        BizRainLatest r = new BizRainLatest();
                        r.setDeviceSn(row.getSensorKey());
                        r.setCollectTime(parseTime(p.path("collectTime").asText(null)));
                        r.setRainHour(num(p, "rainHour"));
                        r.setRainDay(num(p, "rainDay"));
                        if (p.path("errcode").isNumber()) {
                            r.setErrcode(p.path("errcode").asInt());
                        }
                        r.setDevChx(p.path("devChx").asText(null));
                        r.setSource(source);
                        r.setTopic(topic);
                        r.setReceivedAt(received);
                        schemaMapper.upsertRainLatest(r);
                        n++;
                    }
                    default -> {
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (n > 0) {
            log.info("Migrated {} sensor latest rows from JSONB", n);
        }
    }

    private void slimBridge(JsonNode bridge) throws Exception {
        ObjectNode slim = objectMapper.createObjectNode();
        for (String key : new String[]{"tcp", "http", "mqtt"}) {
            if (bridge.has(key)) {
                slim.set(key, bridge.get(key).deepCopy());
            }
        }
        // ensure http.mode defaults
        ObjectNode http = slim.has("http") && slim.get("http").isObject()
                ? (ObjectNode) slim.get("http")
                : objectMapper.createObjectNode();
        if (!http.has("mode")) {
            http.put("mode", "direct");
        }
        if (!http.has("publicBaseUrl")) {
            http.put("publicBaseUrl", "");
        }
        if (!http.has("pushToken")) {
            http.put("pushToken", "");
        }
        if (!http.has("cloud") || !http.get("cloud").isObject()) {
            ObjectNode cloud = objectMapper.createObjectNode();
            cloud.put("baseUrl", "");
            cloud.put("pullPath", "/api/relay/latest");
            cloud.put("sincePath", "/api/relay/since");
            cloud.put("token", "");
            cloud.put("pullIntervalSec", 30);
            cloud.put("backfillEnabled", true);
            cloud.put("retentionHoursOnCloud", 24);
            http.set("cloud", cloud);
        }
        slim.set("http", http);
        if (!slim.has("mqtt")) {
            JsonNode seedMqtt = loadSeed().path("mqtt");
            if (seedMqtt.isObject()) {
                slim.set("mqtt", seedMqtt);
            }
        }
        if (!slim.has("tcp")) {
            JsonNode seedTcp = loadSeed().path("tcp");
            if (seedTcp.isObject()) {
                slim.set("tcp", seedTcp);
            }
        }
        slim.put("note", "仅连接通道配置（tcp/http/mqtt）");
        cfgMapper.updateSensorBridge(objectMapper.writeValueAsString(slim), "schema-split");
    }

    private JsonNode loadSeed() {
        return loadClasspathJson("seed/cfg_sensor_bridge.json");
    }

    private JsonNode loadMappingSeed() {
        return loadClasspathJson("seed/sensor_mapping.json");
    }

    private JsonNode loadClasspathJson(String path) {
        try {
            ClassPathResource res = new ClassPathResource(path);
            String json = StreamUtils.copyToString(res.getInputStream(), StandardCharsets.UTF_8);
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private JsonNode parse(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private static Double num(JsonNode p, String field) {
        JsonNode n = p.get(field);
        if (n == null || n.isNull()) {
            return null;
        }
        if (n.isNumber()) {
            return n.asDouble();
        }
        try {
            return Double.parseDouble(n.asText().trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static OffsetDateTime parseTime(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(s);
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(s.trim(), LOCAL_FMT).atOffset(TZ8);
        } catch (Exception e) {
            return null;
        }
    }
}
