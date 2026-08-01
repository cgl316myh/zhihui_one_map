package com.anr.mineonemap.auth.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RegisterRequest {
    @NotBlank(message = "用户名不能为空")
    private String username;
    private String displayName;
    private String phone;
    @NotBlank(message = "密码不能为空")
    private String password;
}
