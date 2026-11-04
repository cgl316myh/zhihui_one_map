package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/cad-layers")
public class CadLayersAdminController {

    private final CfgMapper cfgMapper;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;
    private final ObjectMapper objectMapper;

    public CadLayersAdminController(CfgMapper cfgMapper, AuditService auditService,
                                    AuthUserDetailsService authUserDetailsService, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ApiResponse<JsonNode> get() {
        return ApiResponse.ok(parsePayload(cfgMapper.getCadLayersPayload()));
    }

    @PutMapping
    public ApiResponse<JsonNode> put(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        cfgMapper.updateCadLayers(toJson(body), actor);
        auditService.log(actor, "cad_layers.update", "cfg_cad_layers", "更新 CAD 矢量图层配置");
        return ApiResponse.ok(body);
    }

    private JsonNode parsePayload(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            throw new BizException("配置 JSON 无效");
        }
    }

    private String toJson(JsonNode body) {
        try {
            return objectMapper.writeValueAsString(body);
        } catch (Exception e) {
            throw new BizException("请求体 JSON 无效");
        }
    }
}
