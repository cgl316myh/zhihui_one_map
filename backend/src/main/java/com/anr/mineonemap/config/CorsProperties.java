package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

@Data
@ConfigurationProperties(prefix = "mine.cors")
public class CorsProperties {
    private List<String> allowedOrigins = new ArrayList<>();
}
