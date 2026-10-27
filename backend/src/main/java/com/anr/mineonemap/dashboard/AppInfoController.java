package com.anr.mineonemap.dashboard;

import com.anr.mineonemap.common.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AppInfoController {

    @Value("${mine.app.version:1.1.0}")
    private String version;

    @GetMapping("/version")
    public ApiResponse<Map<String, String>> version() {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("version", version);
        return ApiResponse.ok(data);
    }
}
