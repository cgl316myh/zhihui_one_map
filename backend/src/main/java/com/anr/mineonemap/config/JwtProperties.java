package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "mine.jwt")
public class JwtProperties {
    private String secret;
    private int accessExpireMinutes = 120;
    private int refreshExpireDays = 7;
}
