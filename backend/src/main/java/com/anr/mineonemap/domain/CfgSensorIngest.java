package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

public class CfgSensorIngest {
    private Short id = 1;
    private Boolean enabled = true;
    private Boolean demoPushEnabled = false;
    private Integer demoPushIntervalSec = 30;
    private Integer envRetentionMonths = 3;
    private OffsetDateTime updatedAt;
    private String updatedBy;

    public Short getId() { return id; }
    public void setId(Short id) { this.id = id; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public Boolean getDemoPushEnabled() { return demoPushEnabled; }
    public void setDemoPushEnabled(Boolean demoPushEnabled) { this.demoPushEnabled = demoPushEnabled; }
    public Integer getDemoPushIntervalSec() { return demoPushIntervalSec; }
    public void setDemoPushIntervalSec(Integer demoPushIntervalSec) { this.demoPushIntervalSec = demoPushIntervalSec; }
    public Integer getEnvRetentionMonths() { return envRetentionMonths; }
    public void setEnvRetentionMonths(Integer envRetentionMonths) { this.envRetentionMonths = envRetentionMonths; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
    public String getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(String updatedBy) { this.updatedBy = updatedBy; }
}
