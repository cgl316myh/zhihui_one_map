package com.anr.mineonemap.domain;

public class CfgFtEnv {
    private Boolean enabled;
    private String webUrl;
    private String apiBase;
    private String username;
    private String password;
    private String cron;
    private Integer lookbackHours;

    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public String getWebUrl() { return webUrl; }
    public void setWebUrl(String webUrl) { this.webUrl = webUrl; }
    public String getApiBase() { return apiBase; }
    public void setApiBase(String apiBase) { this.apiBase = apiBase; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }
    public String getCron() { return cron; }
    public void setCron(String cron) { this.cron = cron; }
    public Integer getLookbackHours() { return lookbackHours; }
    public void setLookbackHours(Integer lookbackHours) { this.lookbackHours = lookbackHours; }
}
