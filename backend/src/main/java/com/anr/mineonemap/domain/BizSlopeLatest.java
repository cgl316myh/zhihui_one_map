package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

public class BizSlopeLatest {
    private String deviceSn;
    private OffsetDateTime collectTime;
    private Double xMm;
    private Double yMm;
    private Double hMm;
    private String deviceType;
    private String source;
    private String topic;
    private OffsetDateTime receivedAt;
    private OffsetDateTime updatedAt;

    public String getDeviceSn() { return deviceSn; }
    public void setDeviceSn(String deviceSn) { this.deviceSn = deviceSn; }
    public OffsetDateTime getCollectTime() { return collectTime; }
    public void setCollectTime(OffsetDateTime collectTime) { this.collectTime = collectTime; }
    public Double getXMm() { return xMm; }
    public void setXMm(Double xMm) { this.xMm = xMm; }
    public Double getYMm() { return yMm; }
    public void setYMm(Double yMm) { this.yMm = yMm; }
    public Double getHMm() { return hMm; }
    public void setHMm(Double hMm) { this.hMm = hMm; }
    public String getDeviceType() { return deviceType; }
    public void setDeviceType(String deviceType) { this.deviceType = deviceType; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public OffsetDateTime getReceivedAt() { return receivedAt; }
    public void setReceivedAt(OffsetDateTime receivedAt) { this.receivedAt = receivedAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
