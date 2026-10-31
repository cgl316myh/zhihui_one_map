package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "mine.bdlx")
public class BdlxProperties {
    /** 关闭后不登录、不定时拉 */
    private boolean enabled = true;
    /** 浏览器登录页，给后台展示用 */
    private String webUrl = "http://bdlx.jgtop1.com/";
    private String apiBase = "http://wtapi.jgtop1.com";
    private String username = "";
    private String password = "";
    /** 可选：直接注入已登录 JWT，跳过验证码 */
    private String token = "";
    /** 每小时第 8 分钟 */
    private String cron = "0 8 * * * *";
    /** 历史回看小时数，默认近一个月 */
    private int lookbackHours = 744;
    private int loginRetries = 8;
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
