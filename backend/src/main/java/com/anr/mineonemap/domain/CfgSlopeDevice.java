package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

public class CfgSlopeDevice {
    private String deviceSn;
    private String externalId;
    private String name;
    private String deviceKind;
    private Boolean enabled = true;
    private Integer sortNo = 0;
    private OffsetDateTime updatedAt;

    public String getDeviceSn() { return deviceSn; }
    public void setDeviceSn(String deviceSn) { this.deviceSn = deviceSn; }
    public String getExternalId() { return externalId; }
    public void setExternalId(String externalId) { this.externalId = externalId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDeviceKind() { return deviceKind; }
    public void setDeviceKind(String deviceKind) { this.deviceKind = deviceKind; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public Integer getSortNo() { return sortNo; }
    public void setSortNo(Integer sortNo) { this.sortNo = sortNo; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
