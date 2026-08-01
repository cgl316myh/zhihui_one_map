package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class SysAuditLog {
    private Long id;
    private String actor;
    private String action;
    private String target;
    private String result;
    private String summary;
    private String ip;
    private Instant createdAt;
}
