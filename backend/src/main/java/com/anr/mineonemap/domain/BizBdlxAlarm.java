package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.OffsetDateTime;

@Data
public class BizBdlxAlarm {
    private Long vendorId;
    private String pointId;
    private String deviceSn;
    private String color;
    private String level;
    private String title;
    private String content;
    private String status;
    private OffsetDateTime alarmTime;
    private String raw;
}
