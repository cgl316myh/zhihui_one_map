package com.anr.mineonemap.domain;

import lombok.Data;

import java.time.Instant;

@Data
public class SysUser {
    private Long id;
    private String username;
    private String passwordHash;
    private String displayName;
    private String phone;
    private String role;
    private Boolean enabled;
    private Instant lastLoginAt;
    private Instant createdAt;
    private Instant updatedAt;
}
