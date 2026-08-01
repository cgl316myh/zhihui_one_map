package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/reserves")
public class ReservesAdminController {

    private final CfgMapper cfgMapper;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;
    private final ObjectMapper objectMapper;

    public ReservesAdminController(CfgMapper cfgMapper, AuditService auditService,
                                   AuthUserDetailsService authUserDetailsService, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ApiResponse<JsonNode> get() {
        return ApiResponse.ok(parsePayload(cfgMapper.getReservesPayload()));
    }

    @PutMapping
    public ApiResponse<JsonNode> put(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        JsonNode existing = parsePayload(cfgMapper.getReservesPayload());
        JsonNode merged = protectYear2025(existing, body);
        cfgMapper.updateReserves(toJson(merged), actor);
        auditService.log(actor, "reserves.update", "cfg_reserves", "更新储量配置");
        return ApiResponse.ok(merged);
    }

    /**
     * 旧版管理端若仍提交仅含 23/24 采区的 payload，自动保留库中已有的 2025 采区与年报快照，防止被覆盖。
     */
    private JsonNode protectYear2025(JsonNode existing, JsonNode incoming) {
        if (incoming == null || !incoming.isObject()) {
            return existing;
        }
        ObjectNode out = incoming.deepCopy();

        JsonNode inDistricts = out.path("districts");
        boolean incomingHas2025 = false;
        if (inDistricts.isArray()) {
            for (JsonNode d : inDistricts) {
                if ("Y2025".equals(d.path("id").asText()) || d.path("name").asText("").contains("2025")) {
                    incomingHas2025 = true;
                    break;
                }
            }
        }

        if (!incomingHas2025 && existing != null && existing.isObject()) {
            JsonNode exDistricts = existing.path("districts");
            JsonNode y2025 = null;
            if (exDistricts.isArray()) {
                for (JsonNode d : exDistricts) {
                    if ("Y2025".equals(d.path("id").asText()) || d.path("name").asText("").contains("2025")) {
                        y2025 = d;
                        break;
                    }
                }
            }
            if (y2025 != null) {
                ArrayNode mergedDistricts = objectMapper.createArrayNode();
                mergedDistricts.add(y2025.deepCopy());
                if (inDistricts.isArray()) {
                    inDistricts.forEach(mergedDistricts::add);
                }
                out.set("districts", mergedDistricts);
            }

            JsonNode exSnap = existing.path("reportSnapshot");
            if (exSnap.has("year2025")) {
                ObjectNode snap = out.has("reportSnapshot") && out.get("reportSnapshot").isObject()
                        ? (ObjectNode) out.get("reportSnapshot").deepCopy()
                        : objectMapper.createObjectNode();
                if (!snap.has("year2025")) {
                    snap.set("year2025", exSnap.get("year2025").deepCopy());
                }
                // 若提交仍是 2024 台账主数据，回填 2025 主指标
                if (Math.abs(out.path("assessedUtilizedReserve").asDouble(0) - 9825.93) < 0.01
                        && existing.path("assessedUtilizedReserve").asDouble(0) > 0) {
                    out.put("assessedUtilizedReserve", existing.path("assessedUtilizedReserve").asDouble());
                    if (existing.has("avgDailyMined")) {
                        out.put("avgDailyMined", existing.path("avgDailyMined").asDouble());
                    }
                    if (existing.has("dataBasis")) {
                        out.put("dataBasis", existing.path("dataBasis").asText());
                    }
                    if (existing.has("dataBasisNote")) {
                        out.put("dataBasisNote", existing.path("dataBasisNote").asText());
                    }
                    if (exSnap.has("preservedResourceKt")) {
                        snap.set("preservedResourceKt", exSnap.get("preservedResourceKt"));
                    }
                    if (exSnap.has("credibleReserveKt")) {
                        snap.set("credibleReserveKt", exSnap.get("credibleReserveKt"));
                    }
                    if (exSnap.has("asOf")) {
                        snap.put("asOf", exSnap.path("asOf").asText());
                    }
                }
                out.set("reportSnapshot", snap);
            }
        }
        return out;
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
