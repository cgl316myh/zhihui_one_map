package com.anr.mineonemap.domain;

import lombok.Data;

@Data
public class CfgBdlx {
    private Boolean enabled;
    private String webUrl;
    private String apiBase;
    private String username;
    private String password;
    private String cron;
    private Integer lookbackHours;
}
