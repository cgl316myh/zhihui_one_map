package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class BizMapPoint {
    private String id;
    private String name;
    private String type;
    private Double lng;
    private Double lat;
    private String externalId;
    private String extra;
    private Instant updatedAt;
}
