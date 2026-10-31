package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "mine.ftenv")
public class FtEnvProperties {
    private boolean enabled = true;
    private String webUrl = "http://182.40.193.119:9010/#/logon";
    private String apiBase = "http://182.40.193.119:8081";
    private String username = "";
    private String password = "";
    private String token = "";
    private String cron = "0 18 * * * *";
    private int lookbackHours = 168;
    private int connectTimeoutMs = 15000;
    private int readTimeoutMs = 60000;

    public boolean ready() {
        if (!enabled) {
            return false;
        }
        boolean hasToken = token != null && !token.isBlank();
        boolean hasUser = username != null && !username.isBlank()
                && password != null && !password.isBlank();
        return hasToken || hasUser;
    }
}
