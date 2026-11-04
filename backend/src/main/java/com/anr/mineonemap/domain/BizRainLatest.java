package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

public class BizRainLatest {
    private String deviceSn;
    private OffsetDateTime collectTime;
    private Double rainHour;
    private Double rainDay;
    private Integer errcode;
    private String devChx;
    private Double lng;
    private Double lat;
    private Boolean online;
    private String maintainer;
    private String vendorPointId;
    private String source;
    private String topic;
    private OffsetDateTime receivedAt;
    private OffsetDateTime updatedAt;

    public String getDeviceSn() { return deviceSn; }
    public void setDeviceSn(String deviceSn) { this.deviceSn = deviceSn; }
    public OffsetDateTime getCollectTime() { return collectTime; }
    public void setCollectTime(OffsetDateTime collectTime) { this.collectTime = collectTime; }
    public Double getRainHour() { return rainHour; }
    public void setRainHour(Double rainHour) { this.rainHour = rainHour; }
    public Double getRainDay() { return rainDay; }
    public void setRainDay(Double rainDay) { this.rainDay = rainDay; }
    public Integer getErrcode() { return errcode; }
    public void setErrcode(Integer errcode) { this.errcode = errcode; }
    public String getDevChx() { return devChx; }
    public void setDevChx(String devChx) { this.devChx = devChx; }
    public Double getLng() { return lng; }
    public void setLng(Double lng) { this.lng = lng; }
    public Double getLat() { return lat; }
    public void setLat(Double lat) { this.lat = lat; }
    public Boolean getOnline() { return online; }
    public void setOnline(Boolean online) { this.online = online; }
    public String getMaintainer() { return maintainer; }
    public void setMaintainer(String maintainer) { this.maintainer = maintainer; }
    public String getVendorPointId() { return vendorPointId; }
    public void setVendorPointId(String vendorPointId) { this.vendorPointId = vendorPointId; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public OffsetDateTime getReceivedAt() { return receivedAt; }
    public void setReceivedAt(OffsetDateTime receivedAt) { this.receivedAt = receivedAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
