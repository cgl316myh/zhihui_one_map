package com.anr.mineonemap.ingest.bdlx;

import com.anr.mineonemap.config.BdlxProperties;
import com.anr.mineonemap.domain.CfgBdlx;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 后台可见/可改的边坡云平台登录配置：库表优先，空则用 application.yml。
 */
@Service
@Order(40)
public class BdlxConfigService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BdlxConfigService.class);

    private final BdlxProperties props;
    private final SensorSchemaMapper schemaMapper;
    private final BdlxVendorClient vendorClient;

    public BdlxConfigService(BdlxProperties props, SensorSchemaMapper schemaMapper,
                             BdlxVendorClient vendorClient) {
        this.props = props;
        this.schemaMapper = schemaMapper;
        this.vendorClient = vendorClient;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            applyDbOverlay();
        } catch (Exception e) {
            log.warn("BDLX cfg overlay skipped: {}", e.getMessage());
        }
    }

    public Map<String, Object> viewForAdmin() {
        try {
            applyDbOverlay();
        } catch (Exception ignored) {
        }
        Map<String, Object> cursor = null;
        try {
            cursor = schemaMapper.getBdlxPull();
        } catch (Exception ignored) {
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", props.isEnabled());
        out.put("webUrl", nz(props.getWebUrl(), "http://bdlx.jgtop1.com/"));
        out.put("apiBase", nz(props.getApiBase(), "http://wtapi.jgtop1.com"));
        out.put("username", props.getUsername() == null ? "" : props.getUsername());
        out.put("password", props.getPassword() == null ? "" : props.getPassword());
        out.put("tokenConfigured", props.getToken() != null && !props.getToken().isBlank());
        out.put("cron", nz(props.getCron(), "0 8 * * * *"));
        out.put("lookbackHours", props.getLookbackHours());
        if (cursor != null) {
            out.put("lastSuccessAt", cursor.get("lastSuccessAt"));
            out.put("lastError", cursor.get("lastError"));
            out.put("pointsUpdated", cursor.get("pointsUpdated"));
            out.put("samplesUpserted", cursor.get("samplesUpserted"));
            out.put("alarmsUpserted", cursor.get("alarmsUpserted"));
        }
        return out;
    }

    public Map<String, Object> saveFromAdmin(JsonNode body) {
        CfgBdlx row = new CfgBdlx();
        row.setEnabled(!body.has("enabled") || body.path("enabled").asBoolean(true));
        row.setWebUrl(text(body, "webUrl", nz(props.getWebUrl(), "http://bdlx.jgtop1.com/")));
        row.setApiBase(text(body, "apiBase", nz(props.getApiBase(), "http://wtapi.jgtop1.com")));
        row.setUsername(text(body, "username", props.getUsername()));
        row.setPassword(text(body, "password", props.getPassword()));
        row.setCron(text(body, "cron", nz(props.getCron(), "0 8 * * * *")));
        int lookback = body.path("lookbackHours").asInt(props.getLookbackHours());
        row.setLookbackHours(Math.max(24, lookback));
        schemaMapper.updateBdlxLoginCfg(row);
        applyToProps(row);
        vendorClient.invalidateToken();
        return viewForAdmin();
    }

    private void applyDbOverlay() {
        Map<String, Object> row = schemaMapper.getBdlxPull();
        if (row == null) {
            return;
        }
        Object user = row.get("username");
        if (user != null && !String.valueOf(user).isBlank()) {
            CfgBdlx cfg = new CfgBdlx();
            Object en = row.get("enabled");
            cfg.setEnabled(en == null || Boolean.TRUE.equals(en) || "true".equalsIgnoreCase(String.valueOf(en)));
            cfg.setWebUrl(str(row.get("webUrl")));
            cfg.setApiBase(str(row.get("apiBase")));
            cfg.setUsername(str(user));
            cfg.setPassword(str(row.get("password")));
            cfg.setCron(str(row.get("cron")));
            Object lb = row.get("lookbackHours");
            if (lb instanceof Number n) {
                cfg.setLookbackHours(n.intValue());
            }
            applyToProps(cfg);
        }
    }

    private void applyToProps(CfgBdlx row) {
        if (row.getEnabled() != null) {
            props.setEnabled(row.getEnabled());
        }
        if (notBlank(row.getWebUrl())) {
            props.setWebUrl(row.getWebUrl().trim());
        }
        if (notBlank(row.getApiBase())) {
            props.setApiBase(row.getApiBase().trim());
        }
        if (row.getUsername() != null) {
            props.setUsername(row.getUsername().trim());
        }
        if (row.getPassword() != null) {
            props.setPassword(row.getPassword());
        }
        if (notBlank(row.getCron())) {
            props.setCron(row.getCron().trim());
        }
        if (row.getLookbackHours() != null) {
            props.setLookbackHours(Math.max(2, row.getLookbackHours()));
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static String nz(String v, String dft) {
        return v == null || v.isBlank() ? dft : v;
    }

    private static String text(JsonNode n, String field, String dft) {
        if (n != null && n.has(field) && !n.get(field).isNull()) {
            return n.get(field).asText("");
        }
        return dft == null ? "" : dft;
    }
}
