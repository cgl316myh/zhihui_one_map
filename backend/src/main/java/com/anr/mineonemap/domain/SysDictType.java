package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class SysDictType {
    private String code;
    private String name;
    private String remark;
    private Instant createdAt;
}
