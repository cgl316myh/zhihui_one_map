package com.anr.mineonemap.auth.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class AuthUserView {
    private Long id;
    private String username;
    private String displayName;
    private String phone;
    private String role;
    private Boolean enabled;
}
