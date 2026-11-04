package com.anr.mineonemap.ingest;

import com.anr.mineonemap.domain.CfgEnvStation;
import com.anr.mineonemap.domain.CfgSensorIngest;
import com.anr.mineonemap.domain.CfgSlopeDevice;
import com.anr.mineonemap.mapper.CfgMapper;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * 连接配置读 cfg_sensor_bridge；策略/站点/阈值读列式表。
 * getConfig() 组装兼容视图供大屏 ViewService 使用。
 */
@Service
public class SensorConfigService {

    private static final Logger log = LoggerFactory.getLogger(SensorConfigService.class);

    private final CfgMapper cfgMapper;
    private final SensorSchemaMapper schemaMapper;
    private final ObjectMapper objectMapper;
    private volatile JsonNode bridgeSeed;

    public SensorConfigService(CfgMapper cfgMapper, SensorSchemaMapper schemaMapper, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.schemaMapper = schemaMapper;
        this.objectMapper = objectMapper;
    }

    /** 仅连接树 tcp/http/mqtt */
    public JsonNode getBridgeConfig() {
        JsonNode db = parse(cfgMapper.getSensorBridgePayload());
        ObjectNode out = db.isObject() ? ((ObjectNode) db).deepCopy() : objectMapper.createObjectNode();
        ensureBridgeDefaults(out);
        return out;
    }

    public void saveBridgeConfig(JsonNode body, String actor) {
        ObjectNode slim = objectMapper.createObjectNode();
        if (body != null && body.isObject()) {
            for (String key : new String[]{"tcp", "http", "mqtt"}) {
                if (body.has(key)) {
                    slim.set(key, body.get(key).deepCopy());
                }
            }
        }
        // 密码留空时保留库内原值，避免后台重保存冲掉
        if (slim.has("mqtt") && slim.get("mqtt").isObject()) {
            ObjectNode mqtt = (ObjectNode) slim.get("mqtt");
            String pwd = mqtt.path("password").asText("");
            if (pwd == null || pwd.isBlank()) {
                String existing = getBridgeConfig().path("mqtt").path("password").asText("");
                if (existing != null && !existing.isBlank()) {
                    mqtt.put("password", existing);
                }
            }
        }
        ensureBridgeDefaults(slim);
        slim.put("note", "仅连接通道配置（tcp/http/mqtt）");
        try {
            cfgMapper.updateSensorBridge(objectMapper.writeValueAsString(slim), actor);
        } catch (Exception e) {
            throw new IllegalArgumentException("bridge JSON invalid", e);
        }
    }

    /** 兼容视图：bridge + ingest + stations + slopeDevices + thresholds */
    public JsonNode getConfig() {
        ObjectNode out = (ObjectNode) getBridgeConfig();
        CfgSensorIngest ingest = schemaMapper.getIngest();
        ObjectNode ingestNode = objectMapper.createObjectNode();
        ingestNode.put("enabled", ingest == null || ingest.getEnabled() == null || ingest.getEnabled());
        ingestNode.put("demoPushEnabled", ingest != null && Boolean.TRUE.equals(ingest.getDemoPushEnabled()));
        int interval = ingest != null && ingest.getDemoPushIntervalSec() != null
                ? ingest.getDemoPushIntervalSec() : 30;
        ingestNode.put("demoPushIntervalSec", Math.max(30, interval));
        int months = ingest != null && ingest.getEnvRetentionMonths() != null
                ? ingest.getEnvRetentionMonths() : 3;
        ingestNode.put("envRetentionMonths", Math.max(1, months));
        out.set("ingest", ingestNode);

        ObjectNode retention = objectMapper.createObjectNode();
        retention.put("months", Math.max(1, months));
        out.set("envRetention", retention);

        ArrayNode stations = objectMapper.createArrayNode();
        List<CfgEnvStation> list = schemaMapper.listStations();
        if (list != null) {
            for (CfgEnvStation st : list) {
                if (st.getEnabled() != null && !st.getEnabled()) {
                    continue;
                }
                ObjectNode n = objectMapper.createObjectNode();
                n.put("id", st.getId());
                n.put("name", st.getName());
                n.put("location", st.getLocation() == null ? "" : st.getLocation());
                if (st.getLng() != null) {
                    n.put("lng", st.getLng());
                }
                if (st.getLat() != null) {
                    n.put("lat", st.getLat());
                }
                ArrayNode clientIds = objectMapper.createArrayNode();
                if (st.getClientId() != null && !st.getClientId().isBlank()) {
                    clientIds.add(st.getClientId());
                }
                n.set("clientIds", clientIds);
                n.set("deviceSns", objectMapper.createArrayNode());
                stations.add(n);
            }
        }
        out.set("environmentStations", stations);

        ObjectNode slope = objectMapper.createObjectNode();
        List<CfgSlopeDevice> devices = schemaMapper.listSlopeDevices();
        if (devices != null) {
            for (CfgSlopeDevice d : devices) {
                if (d.getEnabled() != null && !d.getEnabled()) {
                    continue;
                }
                ObjectNode meta = objectMapper.createObjectNode();
                meta.put("id", d.getExternalId() == null ? d.getDeviceSn() : d.getExternalId());
                meta.put("name", d.getName());
                meta.put("type", d.getDeviceKind());
                slope.set(d.getDeviceSn(), meta);
            }
        }
        out.set("slopeDevices", slope);

        ObjectNode th = objectMapper.createObjectNode();
        Map<String, Object> thRow = schemaMapper.getSensorThreshold();
        th.put("noiseDay", asDouble(thRow, "noiseDay", 60));
        th.put("noiseNight", asDouble(thRow, "noiseNight", 50));
        th.put("pm25", asDouble(thRow, "pm25", 75));
        th.put("pm10", asDouble(thRow, "pm10", 150));
        out.set("thresholds", th);

        out.put("pollHintSec", 30);
        return out;
    }

    public boolean isIngestEnabled() {
        CfgSensorIngest ingest = schemaMapper.getIngest();
        return ingest == null || ingest.getEnabled() == null || ingest.getEnabled();
    }

    public boolean isDemoPushEnabled() {
        CfgSensorIngest ingest = schemaMapper.getIngest();
        return ingest != null && Boolean.TRUE.equals(ingest.getDemoPushEnabled());
    }

    public int getDemoPushIntervalSec() {
        CfgSensorIngest ingest = schemaMapper.getIngest();
        int v = ingest != null && ingest.getDemoPushIntervalSec() != null
                ? ingest.getDemoPushIntervalSec() : 30;
        return Math.max(30, v);
    }

    public int getEnvRetentionMonths() {
        CfgSensorIngest ingest = schemaMapper.getIngest();
        int v = ingest != null && ingest.getEnvRetentionMonths() != null
                ? ingest.getEnvRetentionMonths() : 3;
        return Math.max(1, v);
    }

    public CfgSensorIngest getIngestPolicy() {
        return schemaMapper.getIngest();
    }

    public void saveIngestPolicy(CfgSensorIngest row, String actor) {
        if (row.getDemoPushIntervalSec() != null) {
            row.setDemoPushIntervalSec(Math.max(30, row.getDemoPushIntervalSec()));
        }
        if (row.getEnvRetentionMonths() != null) {
            row.setEnvRetentionMonths(Math.max(1, row.getEnvRetentionMonths()));
        }
        row.setUpdatedBy(actor);
        schemaMapper.updateIngest(row);
    }

    public List<CfgEnvStation> listStations() {
        return schemaMapper.listStations();
    }

    public void replaceStations(List<CfgEnvStation> stations) {
        schemaMapper.deleteAllStations();
        if (stations == null) {
            return;
        }
        int i = 0;
        for (CfgEnvStation st : stations) {
            if (st.getId() == null || st.getId().isBlank()) {
                continue;
            }
            if (st.getSortNo() == null) {
                st.setSortNo(++i);
            }
            schemaMapper.insertStation(st);
        }
    }

    public List<CfgSlopeDevice> listSlopeDevices() {
        return schemaMapper.listSlopeDevices();
    }

    public void replaceSlopeDevices(List<CfgSlopeDevice> devices) {
        schemaMapper.deleteAllSlopeDevices();
        if (devices == null) {
            return;
        }
        int i = 0;
        for (CfgSlopeDevice d : devices) {
            if (d.getDeviceSn() == null || d.getDeviceSn().isBlank()) {
                continue;
            }
            if (d.getDeviceKind() == null || d.getDeviceKind().isBlank()) {
                d.setDeviceKind("displacement");
            }
            if (d.getSortNo() == null) {
                d.setSortNo(++i);
            }
            schemaMapper.insertSlopeDevice(d);
        }
    }

    public void saveSensorThreshold(Double noiseDay, Double noiseNight, Double pm25, Double pm10) {
        schemaMapper.updateSensorThreshold(noiseDay, noiseNight, pm25, pm10);
    }

    public String resolveStationId(String clientId) {
        if (clientId == null || clientId.isBlank()) {
            return null;
        }
        List<CfgEnvStation> list = schemaMapper.listStations();
        if (list == null) {
            return null;
        }
        for (CfgEnvStation st : list) {
            if (clientId.equals(st.getClientId())) {
                return st.getId();
            }
        }
        return null;
    }

    public String httpMode() {
        return getBridgeConfig().path("http").path("mode").asText("direct");
    }

    public String httpPushToken() {
        return getBridgeConfig().path("http").path("pushToken").asText("").trim();
    }

    private void ensureBridgeDefaults(ObjectNode out) {
        JsonNode seed = loadBridgeSeed();
        if (!out.has("tcp") || !out.get("tcp").isObject()) {
            out.set("tcp", seed.path("tcp").deepCopy());
        }
        if (!out.has("mqtt") || !out.get("mqtt").isObject()) {
            out.set("mqtt", seed.path("mqtt").deepCopy());
        }
        ObjectNode http = out.has("http") && out.get("http").isObject()
                ? (ObjectNode) out.get("http")
                : objectMapper.createObjectNode();
        if (http.isEmpty() && seed.path("http").isObject()) {
            http = ((ObjectNode) seed.path("http")).deepCopy();
        }
        if (!http.has("mode")) {
            http.put("mode", "direct");
        }
        if (!http.has("pushPath")) {
            http.put("pushPath", "/api/push");
        }
        if (!http.has("enabled")) {
            http.put("enabled", true);
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
        out.set("http", http);
    }

    private JsonNode loadBridgeSeed() {
        JsonNode cached = bridgeSeed;
        if (cached != null) {
            return cached;
        }
        synchronized (this) {
            if (bridgeSeed != null) {
                return bridgeSeed;
            }
            try {
                ClassPathResource res = new ClassPathResource("seed/cfg_sensor_bridge.json");
                String json = StreamUtils.copyToString(res.getInputStream(), StandardCharsets.UTF_8);
                bridgeSeed = objectMapper.readTree(json);
            } catch (Exception e) {
                log.warn("load seed cfg_sensor_bridge failed: {}", e.getMessage());
                bridgeSeed = objectMapper.createObjectNode();
            }
            return bridgeSeed;
        }
    }

    private JsonNode parse(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private static double asDouble(Map<String, Object> row, String key, double def) {
        if (row == null || row.get(key) == null) {
            return def;
        }
        Object v = row.get(key);
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return def;
        }
    }
}
