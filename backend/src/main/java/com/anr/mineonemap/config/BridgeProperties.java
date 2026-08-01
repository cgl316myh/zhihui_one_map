package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "mine.bridge")
public class BridgeProperties {
    private String baseUrl = "http://127.0.0.1:5173";
}
