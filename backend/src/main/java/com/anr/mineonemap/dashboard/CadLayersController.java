package com.anr.mineonemap.dashboard;

import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 大屏：仅返回 enabled=true 的 CAD 图层元数据（GeoJSON 走静态 /data/cad/*）。
 */
@RestController
@RequestMapping("/api/cad-layers")
public class CadLayersController {

    private final CfgMapper cfgMapper;
    private final ObjectMapper objectMapper;

    public CadLayersController(CfgMapper cfgMapper, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public ApiResponse<ObjectNode> listEnabled() {
        JsonNode root = parsePayload(cfgMapper.getCadLayersPayload());
        ArrayNode src = root.path("layers").isArray()
                ? (ArrayNode) root.path("layers")
                : objectMapper.createArrayNode();

        List<JsonNode> enabled = new ArrayList<>();
        src.forEach(node -> {
            if (node.path("enabled").asBoolean(false)) {
                enabled.add(node);
            }
        });
        enabled.sort(Comparator.comparingInt(n -> n.path("order").asInt(100)));

        ArrayNode outLayers = objectMapper.createArrayNode();
        for (JsonNode n : enabled) {
            ObjectNode slim = objectMapper.createObjectNode();
            slim.put("id", n.path("id").asText(""));
            slim.put("name", n.path("name").asText(""));
            slim.put("group", n.path("group").asText(""));
            slim.put("url", n.path("url").asText(""));
            slim.put("geom", n.path("geom").asText(""));
            slim.put("defaultOn", n.path("defaultOn").asBoolean(false));
            slim.put("order", n.path("order").asInt(100));
            slim.put("zIndex", n.path("zIndex").asInt(400));
            if (n.has("style")) {
                slim.set("style", n.get("style"));
            }
            if (n.has("popupFields")) {
                slim.set("popupFields", n.get("popupFields"));
            }
            outLayers.add(slim);
        }

        ObjectNode result = objectMapper.createObjectNode();
        result.put("version", root.path("version").asInt(1));
        result.set("layers", outLayers);
        result.put("source", "database");
        return ApiResponse.ok(result);
    }

    private JsonNode parsePayload(String payload) {
        try {
            return objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }
}
