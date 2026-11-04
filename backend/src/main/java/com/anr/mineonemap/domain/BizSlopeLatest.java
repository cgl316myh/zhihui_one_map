package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.OffsetDateTime;

@Data
public class BizSlopeLatest {
    private String deviceSn;
    private OffsetDateTime collectTime;
    private Double xMm;
    private Double yMm;
    private Double hMm;
    private Double planeMm;
    private Double planeSpeed;
    private Double planeAcc;
    private Double azimuth;
    private Double totalProjection;
    private Double speedX;
    private Double speedY;
    private Double speedH;
    private Double projectionSpeed;
    private Double projectionAcc;
    private Double intervalHours;
    private Double lng;
    private Double lat;
    private Boolean online;
    private String maintainer;
    private String vendorPointId;
    private String vendorColor;
    private String alarmText;
    private String deviceType;
    private String source;
    private String topic;
    private OffsetDateTime receivedAt;
    private OffsetDateTime updatedAt;
}
