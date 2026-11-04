package com.anr.mineonemap.admin.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateUserRequest {
    @NotBlank
    private String username;
    private String displayName;
    private String phone;
    @NotBlank
    private String password;
    private String role = "user";
}
