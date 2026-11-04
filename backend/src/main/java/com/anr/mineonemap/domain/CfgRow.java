package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class CfgRow {
    private Integer id;
    private String payload;
    private Instant updatedAt;
    private String updatedBy;
}
