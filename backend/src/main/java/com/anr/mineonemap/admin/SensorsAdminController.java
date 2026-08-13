package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.CfgEnvStation;
import com.anr.mineonemap.domain.CfgSensorIngest;
import com.anr.mineonemap.domain.CfgSlopeDevice;
import com.anr.mineonemap.ingest.CloudRelayPullScheduler;
import com.anr.mineonemap.ingest.MqttIngestService;
import com.anr.mineonemap.ingest.SensorConfigService;
import com.anr.mineonemap.ingest.SensorLatestStore;
import com.anr.mineonemap.ingest.SensorPayloadIngestor;
import com.anr.mineonemap.ingest.SensorViewService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/sensors")
public class SensorsAdminController {

    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;
    private final ObjectMapper objectMapper;
    private final MqttIngestService mqttIngestService;
    private final SensorPayloadIngestor ingestor;
    private final SensorConfigService configService;
    private final SensorViewService viewService;
    private final CloudRelayPullScheduler cloudRelayPullScheduler;

    public SensorsAdminController(AuditService auditService,
                                  AuthUserDetailsService authUserDetailsService, ObjectMapper objectMapper,
                                  MqttIngestService mqttIngestService,
                                  SensorPayloadIngestor ingestor,
                                  SensorConfigService configService,
                                  SensorViewService viewService,
                                  CloudRelayPullScheduler cloudRelayPullScheduler) {
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
        this.objectMapper = objectMapper;
        this.mqttIngestService = mqttIngestService;
        this.ingestor = ingestor;
        this.configService = configService;
        this.viewService = viewService;
        this.cloudRelayPullScheduler = cloudRelayPullScheduler;
    }

    /** 兼容：返回合并视图（连接+策略+映射） */
    @GetMapping
    public ApiResponse<JsonNode> get() {
        return ApiResponse.ok(configService.getConfig());
    }

    @GetMapping("/bridge")
    public ApiResponse<JsonNode> getBridge() {
        return ApiResponse.ok(configService.getBridgeConfig());
    }

    @PutMapping("/bridge")
    public ApiResponse<JsonNode> putBridge(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        configService.saveBridgeConfig(body, actor);
        auditService.log(actor, "sensors.bridge_update", "cfg_sensor_bridge", "更新接入连接配置");
        mqttIngestService.reconnectFromConfig();
        return ApiResponse.ok(configService.getBridgeConfig());
    }

    /** 旧 PUT：若含 tcp/http/mqtt 则写 bridge；策略字段写列式表 */
    @PutMapping
    public ApiResponse<JsonNode> put(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        if (body != null && body.isObject()) {
            if (body.has("tcp") || body.has("http") || body.has("mqtt")) {
                configService.saveBridgeConfig(body, actor);
                mqttIngestService.reconnectFromConfig();
            }
            if (body.has("ingest") && body.get("ingest").isObject()) {
                JsonNode ing = body.get("ingest");
                CfgSensorIngest row = configService.getIngestPolicy();
                if (row == null) {
                    row = new CfgSensorIngest();
                }
                if (ing.has("enabled")) {
                    row.setEnabled(ing.path("enabled").asBoolean(true));
                }
                if (ing.has("demoPushEnabled")) {
                    row.setDemoPushEnabled(ing.path("demoPushEnabled").asBoolean(false));
                }
                if (ing.has("demoPushIntervalSec")) {
                    row.setDemoPushIntervalSec(ing.path("demoPushIntervalSec").asInt(30));
                }
                if (ing.has("envRetentionMonths")) {
                    row.setEnvRetentionMonths(ing.path("envRetentionMonths").asInt(3));
                }
                configService.saveIngestPolicy(row, actor);
            }
        }
        auditService.log(actor, "sensors.update", "cfg_sensor", "更新传感器配置（兼容接口）");
        return ApiResponse.ok(configService.getConfig());
    }

    @GetMapping("/policy")
    public ApiResponse<Map<String, Object>> getPolicy() {
        CfgSensorIngest ing = configService.getIngestPolicy();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", ing == null || ing.getEnabled() == null || ing.getEnabled());
        data.put("demoPushEnabled", ing != null && Boolean.TRUE.equals(ing.getDemoPushEnabled()));
        data.put("demoPushIntervalSec", ing != null && ing.getDemoPushIntervalSec() != null
                ? Math.max(30, ing.getDemoPushIntervalSec()) : 30);
        data.put("envRetentionMonths", ing != null && ing.getEnvRetentionMonths() != null
                ? Math.max(1, ing.getEnvRetentionMonths()) : 3);
        Map<String, Object> th = new LinkedHashMap<>();
        JsonNode cfg = configService.getConfig().path("thresholds");
        th.put("noiseDay", cfg.path("noiseDay").asDouble(60));
        th.put("noiseNight", cfg.path("noiseNight").asDouble(50));
        th.put("pm25", cfg.path("pm25").asDouble(75));
        th.put("pm10", cfg.path("pm10").asDouble(150));
        data.put("thresholds", th);
        return ApiResponse.ok(data);
    }

    @PutMapping("/policy")
    public ApiResponse<Map<String, Object>> putPolicy(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        CfgSensorIngest row = configService.getIngestPolicy();
        if (row == null) {
            row = new CfgSensorIngest();
        }
        if (body != null) {
            if (body.has("enabled")) {
                row.setEnabled(body.path("enabled").asBoolean(true));
            }
            if (body.has("demoPushEnabled")) {
                row.setDemoPushEnabled(body.path("demoPushEnabled").asBoolean(false));
            }
            if (body.has("demoPushIntervalSec")) {
                row.setDemoPushIntervalSec(body.path("demoPushIntervalSec").asInt(30));
            }
            if (body.has("envRetentionMonths")) {
                row.setEnvRetentionMonths(body.path("envRetentionMonths").asInt(3));
            }
            JsonNode th = body.path("thresholds");
            if (th.isObject()) {
                configService.saveSensorThreshold(
                        th.path("noiseDay").asDouble(60),
                        th.path("noiseNight").asDouble(50),
                        th.path("pm25").asDouble(75),
                        th.path("pm10").asDouble(150));
            }
        }
        configService.saveIngestPolicy(row, actor);
        mqttIngestService.reconnectFromConfig();
        auditService.log(actor, "sensors.policy_update", "cfg_sensor_ingest", "更新接收策略");
        return getPolicy();
    }

    @GetMapping("/stations")
    public ApiResponse<List<CfgEnvStation>> stations() {
        return ApiResponse.ok(configService.listStations());
    }

    @PutMapping("/stations")
    public ApiResponse<List<CfgEnvStation>> putStations(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        List<CfgEnvStation> list = new ArrayList<>();
        JsonNode arr = body != null && body.isArray() ? body : (body != null ? body.path("stations") : null);
        if (arr != null && arr.isArray()) {
            int i = 0;
            for (JsonNode n : arr) {
                CfgEnvStation st = new CfgEnvStation();
                st.setId(n.path("id").asText(null));
                st.setName(n.path("name").asText(st.getId()));
                st.setLocation(n.path("location").asText(null));
                if (n.path("lng").isNumber()) {
                    st.setLng(n.path("lng").asDouble());
                }
                if (n.path("lat").isNumber()) {
                    st.setLat(n.path("lat").asDouble());
                }
                String clientId = n.path("clientId").asText(null);
                if ((clientId == null || clientId.isBlank()) && n.path("clientIds").isArray()
                        && !n.path("clientIds").isEmpty()) {
                    clientId = n.path("clientIds").get(0).asText(null);
                }
                st.setClientId(clientId);
                st.setEnabled(!n.has("enabled") || n.path("enabled").asBoolean(true));
                st.setSortNo(n.path("sortNo").asInt(++i));
                list.add(st);
            }
        }
        configService.replaceStations(list);
        auditService.log(actor, "sensors.stations_update", "cfg_env_station", "更新环境站点 " + list.size());
        return ApiResponse.ok(configService.listStations());
    }

    @GetMapping("/slope-devices")
    public ApiResponse<List<CfgSlopeDevice>> slopeDevices() {
        return ApiResponse.ok(configService.listSlopeDevices());
    }

    @PutMapping("/slope-devices")
    public ApiResponse<List<CfgSlopeDevice>> putSlopeDevices(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        List<CfgSlopeDevice> list = new ArrayList<>();
        JsonNode arr = body != null && body.isArray() ? body : (body != null ? body.path("devices") : null);
        if (arr != null && arr.isArray()) {
            int i = 0;
            for (JsonNode n : arr) {
                CfgSlopeDevice d = new CfgSlopeDevice();
                d.setDeviceSn(n.path("deviceSn").asText(n.path("sn").asText(null)));
                d.setExternalId(n.path("externalId").asText(n.path("id").asText(null)));
                d.setName(n.path("name").asText(d.getDeviceSn()));
                d.setDeviceKind(n.path("deviceKind").asText(n.path("type").asText("displacement")));
                d.setEnabled(!n.has("enabled") || n.path("enabled").asBoolean(true));
                d.setSortNo(n.path("sortNo").asInt(++i));
                list.add(d);
            }
        }
        configService.replaceSlopeDevices(list);
        auditService.log(actor, "sensors.slope_devices_update", "cfg_slope_device", "更新边坡设备 " + list.size());
        return ApiResponse.ok(configService.listSlopeDevices());
    }

    @GetMapping("/live-status")
    public ApiResponse<JsonNode> liveStatus() {
        return ApiResponse.ok(viewService.buildStatus());
    }

    @PostMapping("/test-push")
    public ApiResponse<Map<String, Object>> testPush(@RequestBody(required = false) JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        if (!configService.isIngestEnabled()) {
            throw new BizException(503, "接收总开关已关闭，请先启用后再测试推送");
        }
        JsonNode payload = (body == null || body.isNull() || (body.isObject() && body.isEmpty()))
                ? defaultTestPayload()
                : body;
        boolean ok = ingestor.ingest(payload, "http");
        if (!ok) {
            throw new BizException(503, "推送未接收（ingest 关闭）");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("accepted", true);
        data.put("receivedAt", SensorLatestStore.nowIso());
        data.put("payload", payload);
        data.put("status", viewService.buildStatus());
        data.put("environment", viewService.buildEnvironment());
        String clientId = payload.path("clientId").asText(payload.path("deviceSn").asText("test"));
        auditService.log(actor, "sensors.test_push", "biz_env_latest", "测试推送 · " + clientId);
        return ApiResponse.ok(data);
    }

    @PostMapping("/pull-now")
    public ApiResponse<Map<String, Object>> pullNow() {
        String actor = authUserDetailsService.currentUser().getUsername();
        try {
            int n = cloudRelayPullScheduler.pullOnce(true);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("pulled", n);
            data.put("status", viewService.buildStatus());
            auditService.log(actor, "sensors.pull_now", "cloud_relay", "立即拉取云机 · " + n);
            return ApiResponse.ok(data);
        } catch (Exception e) {
            throw new BizException(502, "云机拉取失败：" + e.getMessage());
        }
    }

    @GetMapping("/cloud-health")
    public ApiResponse<JsonNode> cloudHealth() {
        return ApiResponse.ok(cloudRelayPullScheduler.cloudHealth());
    }

    private JsonNode defaultTestPayload() {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("clientId", "Pczd8HKi3MdgGTW6SAeB");
        n.put("ambientTemperature", 26.5);
        n.put("ambientHumidity", 55);
        n.put("noise", 48);
        n.put("PM2.5", 20);
        n.put("PM10", 35);
        n.put("pressure", 1012);
        n.put("detectedTime", java.time.LocalDateTime.now(
                java.time.ZoneId.of("Asia/Shanghai")).format(
                java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        n.put("longitude", 102.44505);
        n.put("latitude", 24.78545);
        return n;
    }
}
