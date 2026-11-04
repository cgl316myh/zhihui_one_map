package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class BizVideoCamera {
    private String id;
    private String name;
    private Double lng;
    private Double lat;
    private Boolean online;
    private String scene;
    private Integer sortNo;
    private String extra;
    private Instant updatedAt;
}
