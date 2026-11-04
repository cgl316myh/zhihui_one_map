package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.OffsetDateTime;

@Data
public class BizSensorLatest {
    private String category;
    private String sensorKey;
    private String source;
    private String topic;
    private String payload;
    private OffsetDateTime receivedAt;
    private OffsetDateTime updatedAt;
}
