package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.BizVideoCamera;
import com.anr.mineonemap.video.VideoConfigService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/video")
public class VideoAdminController {

    private final VideoConfigService videoConfigService;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;
    private final ObjectMapper objectMapper;

    public VideoAdminController(VideoConfigService videoConfigService, AuditService auditService,
                                AuthUserDetailsService authUserDetailsService, ObjectMapper objectMapper) {
        this.videoConfigService = videoConfigService;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/platform")
    public ApiResponse<JsonNode> getPlatform() {
        return ApiResponse.ok(videoConfigService.getPlatformConfigForAdmin());
    }

    @PutMapping("/platform")
    public ApiResponse<JsonNode> putPlatform(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        videoConfigService.updatePlatformConfig(body, actor);
        auditService.log(actor, "video.platform_update", "cfg_video_platform", "更新视频监控平台配置");
        return ApiResponse.ok(videoConfigService.getPlatformConfigForAdmin());
    }

    @GetMapping("/cameras")
    public ApiResponse<List<BizVideoCamera>> listCameras() {
        return ApiResponse.ok(videoConfigService.listCameras());
    }

    @PutMapping("/cameras")
    public ApiResponse<List<BizVideoCamera>> putCameras(@RequestBody JsonNode body) {
        String actor = authUserDetailsService.currentUser().getUsername();
        JsonNode arr = body.path("cameras");
        if (!arr.isArray()) {
            throw new BizException("请求体须包含 cameras 数组");
        }
        List<BizVideoCamera> cameras = new ArrayList<>();
        for (JsonNode c : arr) {
            BizVideoCamera cam = new BizVideoCamera();
            cam.setId(c.path("id").asText(""));
            cam.setName(c.path("name").asText(cam.getId()));
            cam.setLng(c.has("lng") && !c.get("lng").isNull() ? c.get("lng").asDouble() : null);
            cam.setLat(c.has("lat") && !c.get("lat").isNull() ? c.get("lat").asDouble() : null);
            cam.setOnline(c.path("online").asBoolean(false));
            cam.setScene(c.path("scene").asText(""));
            cam.setSortNo(c.path("sortNo").asInt(0));
            JsonNode extra = c.get("extra");
            if (extra != null && !extra.isNull()) {
                try {
                    cam.setExtra(objectMapper.writeValueAsString(extra));
                } catch (Exception e) {
                    cam.setExtra("{}");
                }
            } else {
                cam.setExtra("{}");
            }
            cameras.add(cam);
        }
        videoConfigService.replaceCameras(cameras, actor);
        auditService.log(actor, "video.cameras_update", "biz_video_camera", "更新摄像头列表 " + cameras.size());
        return ApiResponse.ok(videoConfigService.listCameras());
    }

    @PostMapping("/test-token")
    public ApiResponse<Map<String, Object>> testToken() {
        String actor = authUserDetailsService.currentUser().getUsername();
        Map<String, Object> result = videoConfigService.testEzvizToken();
        auditService.log(actor, "video.test_token", "cfg_video_platform", "测试萤石 Token");
        return ApiResponse.ok(result);
    }
}
