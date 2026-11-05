package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.config.AlertDisplayService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/alert-display")
public class AlertDisplayAdminController {

    private final AlertDisplayService alertDisplayService;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;

    public AlertDisplayAdminController(AlertDisplayService alertDisplayService,
                                       AuditService auditService,
                                       AuthUserDetailsService authUserDetailsService) {
        this.alertDisplayService = alertDisplayService;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
    }

    @GetMapping
    public ApiResponse<JsonNode> get() {
        return ApiResponse.ok(alertDisplayService.getConfig());
    }

    @PutMapping
    public ApiResponse<JsonNode> put(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        JsonNode saved = alertDisplayService.save(body, actor);
        boolean enabled = saved.path("enabled").asBoolean(true);
        auditService.log(actor, "alert_display.update", "cfg_alert_display",
                enabled ? "开启报警显示" : "关闭报警显示（大屏一律正常）");
        return ApiResponse.ok(saved);
    }
}
