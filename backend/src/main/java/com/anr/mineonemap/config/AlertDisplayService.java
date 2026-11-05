package com.anr.mineonemap.config;

import com.anr.mineonemap.mapper.CfgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/**
 * 大屏报警显示开关：默认关闭（不报警）。
 * enabled=false 时环境/边坡对外一律 normal，报警列表为空。
 */
@Service
public class AlertDisplayService {

    private final CfgMapper cfgMapper;
    private final ObjectMapper objectMapper;

    public AlertDisplayService(CfgMapper cfgMapper, ObjectMapper objectMapper) {
        this.cfgMapper = cfgMapper;
        this.objectMapper = objectMapper;
    }

    public boolean isEnabled() {
        try {
            String payload = cfgMapper.getAlertDisplayPayload();
            if (payload == null || payload.isBlank()) {
                return false;
            }
            JsonNode node = objectMapper.readTree(payload);
            if (node.has("enabled") && node.get("enabled").isBoolean()) {
                return node.get("enabled").asBoolean();
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public JsonNode getConfig() {
        try {
            String payload = cfgMapper.getAlertDisplayPayload();
            JsonNode node = objectMapper.readTree(payload == null || payload.isBlank() ? "{}" : payload);
            if (!(node instanceof ObjectNode obj)) {
                ObjectNode out = objectMapper.createObjectNode();
                out.put("enabled", false);
                return out;
            }
            if (!obj.has("enabled")) {
                obj.put("enabled", false);
            }
            return obj;
        } catch (Exception e) {
            ObjectNode out = objectMapper.createObjectNode();
            out.put("enabled", false);
            return out;
        }
    }

    public JsonNode save(JsonNode body, String actor) {
        ObjectNode out = objectMapper.createObjectNode();
        boolean enabled = false;
        if (body != null && body.has("enabled")) {
            enabled = body.get("enabled").asBoolean(false);
        }
        out.put("enabled", enabled);
        out.put("updatedAt", java.time.OffsetDateTime.now().toString());
        try {
            cfgMapper.updateAlertDisplay(objectMapper.writeValueAsString(out), actor);
        } catch (Exception e) {
            throw new IllegalStateException("保存报警显示配置失败", e);
        }
        return out;
    }

    /** 关闭报警显示时，把 points / rainfall 状态压成 normal，并清空 alarms。 */
    public JsonNode muteIfDisabled(JsonNode root) {
        if (isEnabled() || root == null || root.isNull()) {
            return root;
        }
        if (!(root instanceof ObjectNode obj)) {
            return root;
        }
        ObjectNode copy = obj.deepCopy();
        JsonNode points = copy.get("points");
        if (points instanceof ArrayNode arr) {
            ArrayNode next = objectMapper.createArrayNode();
            for (JsonNode p : arr) {
                if (p instanceof ObjectNode po) {
                    ObjectNode pc = po.deepCopy();
                    if (pc.has("status")) {
                        pc.put("status", "normal");
                    }
                    if (pc.has("computedStatus")) {
                        pc.put("computedStatus", "normal");
                    }
                    next.add(pc);
                } else {
                    next.add(p);
                }
            }
            copy.set("points", next);
        }
        if (copy.has("rainfall") && copy.get("rainfall") instanceof ObjectNode rain) {
            ObjectNode rc = rain.deepCopy();
            if (rc.has("status")) {
                rc.put("status", "normal");
            }
            copy.set("rainfall", rc);
        }
        if (copy.has("alarms")) {
            copy.set("alarms", objectMapper.createArrayNode());
        }
        return copy;
    }
}
