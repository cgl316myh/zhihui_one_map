package com.anr.mineonemap.admin.dto;

import lombok.Data;

@Data
public class UpdateUserRequest {
    private String displayName;
    private String phone;
    private String role;
    private Boolean enabled;
}
