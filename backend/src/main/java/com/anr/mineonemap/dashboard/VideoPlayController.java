package com.anr.mineonemap.dashboard;

import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.video.VideoConfigService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/video")
public class VideoPlayController {

    private final VideoConfigService videoConfigService;

    public VideoPlayController(VideoConfigService videoConfigService) {
        this.videoConfigService = videoConfigService;
    }

    @PostMapping("/{id}/play")
    public ApiResponse<Map<String, Object>> play(@PathVariable("id") String id) {
        return ApiResponse.ok(videoConfigService.startPlayback(id));
    }

    @PostMapping("/{id}/stop")
    public ApiResponse<Map<String, Object>> stop(@PathVariable("id") String id) {
        return ApiResponse.ok(videoConfigService.stopPlayback(id));
    }
}
