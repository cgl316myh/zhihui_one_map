package com.anr.mineonemap.ingest;

import com.anr.mineonemap.common.ApiResponse;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * HTTP 推送接入（对标 sensor_bridge POST /api/push）。
 */
@RestController
public class SensorPushController {

    private final SensorPayloadIngestor ingestor;
    private final SensorViewService viewService;
    private final SensorConfigService configService;

    public SensorPushController(SensorPayloadIngestor ingestor, SensorViewService viewService,
                                SensorConfigService configService) {
        this.ingestor = ingestor;
        this.viewService = viewService;
        this.configService = configService;
    }

    @PostMapping("/api/push")
    public ResponseEntity<Map<String, Object>> push(
            @RequestBody(required = false) JsonNode body,
            @RequestHeader(value = "X-Push-Token", required = false) String pushToken,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        if (body == null || body.isNull()) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("ok", false);
            err.put("message", "empty body");
            return ResponseEntity.badRequest().body(err);
        }
        String expected = configService.httpPushToken();
        if (expected != null && !expected.isBlank()) {
            String got = pushToken;
            if ((got == null || got.isBlank()) && authorization != null && authorization.startsWith("Bearer ")) {
                got = authorization.substring(7).trim();
            }
            if (!expected.equals(got)) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("ok", false);
                err.put("message", "invalid push token");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
            }
        }
        if (!configService.isIngestEnabled()) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("ok", false);
            err.put("message", "ingest disabled by admin");
            err.put("receivedAt", SensorLatestStore.nowIso());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(err);
        }
        boolean accepted = ingestor.ingest(body, "http");
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("ok", accepted);
        ok.put("receivedAt", SensorLatestStore.nowIso());
        if (!accepted) {
            ok.put("message", "ingest disabled by admin");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ok);
        }
        return ResponseEntity.ok(ok);
    }

    @GetMapping("/api/sensors/status")
    public ApiResponse<JsonNode> status() {
        return ApiResponse.ok(viewService.buildStatus());
    }
}
