package com.anr.mineonemap.config;

import com.anr.mineonemap.domain.BizMapPoint;
import com.anr.mineonemap.domain.BizVideoCamera;
import com.anr.mineonemap.domain.SysUser;
import com.anr.mineonemap.mapper.BizMapPointMapper;
import com.anr.mineonemap.mapper.BizVideoCameraMapper;
import com.anr.mineonemap.mapper.CfgMapper;
import com.anr.mineonemap.mapper.SysUserMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;

/**
 * 仅在空库时写入初始化配置/点位。请求路径不得再读这些 seed 文件作为运行时回退。
 */
@Component
public class DataInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final SysUserMapper sysUserMapper;
    private final CfgMapper cfgMapper;
    private final BizVideoCameraMapper videoCameraMapper;
    private final BizMapPointMapper mapPointMapper;
    private final PasswordEncoder passwordEncoder;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper objectMapper;

    public DataInitializer(SysUserMapper sysUserMapper, CfgMapper cfgMapper,
                           BizVideoCameraMapper videoCameraMapper,
                           BizMapPointMapper mapPointMapper,
                           PasswordEncoder passwordEncoder, ResourceLoader resourceLoader,
                           ObjectMapper objectMapper) {
        this.sysUserMapper = sysUserMapper;
        this.cfgMapper = cfgMapper;
        this.videoCameraMapper = videoCameraMapper;
        this.mapPointMapper = mapPointMapper;
        this.passwordEncoder = passwordEncoder;
        this.resourceLoader = resourceLoader;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        ensureUser("admin", "系统管理员", "admin", "123456");
        ensureUser("user", "值班员", "user", "123456");

        seedIfEmpty("cfg_env_threshold.json", cfgMapper::getEnvThresholdPayload,
                json -> cfgMapper.updateEnvThreshold(json, "system"));
        seedIfEmpty("cfg_map.json", cfgMapper::getMapPayload,
                json -> cfgMapper.updateMap(json, "system"));
        seedIfEmpty("cfg_sensor_bridge.json", cfgMapper::getSensorBridgePayload,
                json -> cfgMapper.updateSensorBridge(json, "system"));
        seedIfEmpty("cfg_reserves.json", cfgMapper::getReservesPayload,
                json -> cfgMapper.updateReserves(json, "system"));
        ensureReserves2025();
        seedIfEmpty("biz_production.json", cfgMapper::getProductionPayload,
                cfgMapper::updateProduction);
        seedVideoCameras();
        seedMapPoints();
    }

    /**
     * 若库中储量仍无 2025 采区/年报快照，强制用 seed/cfg_reserves.json 覆盖。
     * 防止浏览器旧草稿经管理端 PUT 后长期停在 23/24。
     */
    private void ensureReserves2025() {
        try {
            String current = cfgMapper.getReservesPayload();
            JsonNode node = objectMapper.readTree(current == null || current.isBlank() ? "{}" : current);
            boolean hasY2025District = false;
            JsonNode districts = node.path("districts");
            if (districts.isArray()) {
                for (JsonNode d : districts) {
                    String id = d.path("id").asText("");
                    String name = d.path("name").asText("");
                    if ("Y2025".equals(id) || name.contains("2025")) {
                        hasY2025District = true;
                        break;
                    }
                }
            }
            boolean hasYearSnap = node.path("reportSnapshot").has("year2025");
            String basis = node.path("dataBasis").asText("");
            // 评估利用仍为 2024 台账 9825.93、或依据不含 2025，一律重载
            double assessed = node.path("assessedUtilizedReserve").asDouble(0);
            boolean looksLike2024Ledger = Math.abs(assessed - 9825.93) < 0.01 || !basis.contains("2025");
            if (hasY2025District && hasYearSnap && !looksLike2024Ledger) {
                return;
            }
            Resource resource = resourceLoader.getResource("classpath:seed/cfg_reserves.json");
            if (!resource.exists()) {
                return;
            }
            String json = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8).trim();
            if (json.isEmpty()) {
                return;
            }
            cfgMapper.updateReserves(json, "system-2025-ensure");
            log.info("cfg_reserves missing 2025 data — reloaded from seed/cfg_reserves.json");
        } catch (Exception e) {
            log.warn("ensureReserves2025 failed: {}", e.getMessage());
        }
    }

    private void seedVideoCameras() {
        if (videoCameraMapper.listAll() != null && !videoCameraMapper.listAll().isEmpty()) {
            return;
        }
        Resource resource = resourceLoader.getResource("classpath:seed/video.json");
        if (!resource.exists()) {
            return;
        }
        try {
            JsonNode root = objectMapper.readTree(resource.getInputStream());
            JsonNode cameras = root.path("cameras");
            if (!cameras.isArray()) {
                return;
            }
            int i = 0;
            for (JsonNode c : cameras) {
                BizVideoCamera cam = new BizVideoCamera();
                cam.setId(c.path("id").asText("CAM-" + (++i)));
                cam.setName(c.path("name").asText(cam.getId()));
                cam.setLng(c.has("lng") ? c.get("lng").asDouble() : null);
                cam.setLat(c.has("lat") ? c.get("lat").asDouble() : null);
                cam.setOnline(c.path("online").asBoolean(false));
                cam.setScene(c.path("scene").asText(""));
                cam.setSortNo(i);
                cam.setExtra("{}");
                videoCameraMapper.upsert(cam);
            }
            log.info("Seeded {} video cameras", cameras.size());
        } catch (Exception e) {
            log.warn("Failed to seed video cameras: {}", e.getMessage());
        }
    }

    /** 空表时导入边坡/雨量坐标元数据到 biz_map_point，并把中心写入 cfg_map */
    private void seedMapPoints() {
        if (mapPointMapper.countAll() > 0) {
            return;
        }
        Resource resource = resourceLoader.getResource("classpath:seed/slope-points.json");
        if (!resource.exists()) {
            return;
        }
        try {
            JsonNode root = objectMapper.readTree(resource.getInputStream());
            JsonNode points = root.path("points");
            if (!points.isArray()) {
                return;
            }
            for (JsonNode p : points) {
                BizMapPoint point = new BizMapPoint();
                point.setId(p.path("id").asText());
                if (point.getId() == null || point.getId().isBlank()) {
                    continue;
                }
                point.setName(p.path("name").asText(point.getId()));
                point.setType(p.path("type").asText("displacement"));
                point.setLng(p.has("lng") ? p.get("lng").asDouble() : null);
                point.setLat(p.has("lat") ? p.get("lat").asDouble() : null);
                point.setExternalId(p.path("sn").asText(null));
                ObjectNode extra = objectMapper.createObjectNode();
                if (p.has("sn")) extra.put("sn", p.get("sn").asText());
                if (p.has("sensorType")) extra.put("sensorType", p.get("sensorType").asText());
                if (p.has("deviceType")) extra.put("deviceType", p.get("deviceType").asInt());
                if (p.has("alt")) extra.put("alt", p.get("alt").asDouble());
                point.setExtra(objectMapper.writeValueAsString(extra));
                mapPointMapper.upsert(point);
            }

            // 合并地图中心到 cfg_map（不覆盖已有非空配置中的其他字段）
            ObjectNode mapCfg = (ObjectNode) parseOrEmpty(cfgMapper.getMapPayload());
            if (!mapCfg.has("mapCenter") && root.has("mapCenter")) {
                mapCfg.set("mapCenter", root.get("mapCenter"));
            }
            if (!mapCfg.has("mapZoom") && root.has("mapZoom")) {
                mapCfg.put("mapZoom", root.get("mapZoom").asInt(15));
            }
            if (!mapCfg.has("project") && root.has("project")) {
                mapCfg.put("project", root.get("project").asText());
            }
            cfgMapper.updateMap(objectMapper.writeValueAsString(mapCfg), "system");
            log.info("Seeded {} map points from slope-points.json", points.size());
        } catch (Exception e) {
            log.warn("Failed to seed map points: {}", e.getMessage());
        }
    }

    private JsonNode parseOrEmpty(String payload) {
        try {
            JsonNode n = objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
            return n.isObject() ? n : objectMapper.createObjectNode();
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private void ensureUser(String username, String displayName, String role, String rawPassword) {
        SysUser existing = sysUserMapper.findByUsername(username);
        if (existing != null) {
            return;
        }
        SysUser user = new SysUser();
        user.setUsername(username);
        user.setDisplayName(displayName);
        user.setPasswordHash(passwordEncoder.encode(rawPassword));
        user.setRole(role);
        user.setEnabled(true);
        sysUserMapper.insert(user);
        log.info("Seeded default user: {}", username);
    }

    private void seedIfEmpty(String seedFile, Supplier<String> payloadGetter, java.util.function.Consumer<String> updater) {
        String current = payloadGetter.get();
        if (!isEmptyPayload(current)) {
            return;
        }
        Resource resource = resourceLoader.getResource("classpath:seed/" + seedFile);
        if (!resource.exists()) {
            return;
        }
        try {
            String json = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8).trim();
            if (json.isEmpty()) {
                return;
            }
            updater.accept(json);
            log.info("Loaded seed data from {}", seedFile);
        } catch (Exception e) {
            log.warn("Failed to load seed {}: {}", seedFile, e.getMessage());
        }
    }

    private boolean isEmptyPayload(String payload) {
        if (payload == null || payload.isBlank()) {
            return true;
        }
        String trimmed = payload.trim();
        return "{}".equals(trimmed) || "null".equals(trimmed);
    }
}
