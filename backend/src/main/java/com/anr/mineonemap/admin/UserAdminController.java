package com.anr.mineonemap.admin;

import com.anr.mineonemap.admin.dto.CreateUserRequest;
import com.anr.mineonemap.admin.dto.ResetPasswordRequest;
import com.anr.mineonemap.admin.dto.UpdateUserRequest;
import com.anr.mineonemap.auth.AuthService;
import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.auth.dto.AuthUserView;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.SysUser;
import com.anr.mineonemap.mapper.SysUserMapper;
import jakarta.validation.Valid;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin/users")
public class UserAdminController {

    private final SysUserMapper sysUserMapper;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;

    public UserAdminController(SysUserMapper sysUserMapper, PasswordEncoder passwordEncoder,
                               AuditService auditService, AuthUserDetailsService authUserDetailsService) {
        this.sysUserMapper = sysUserMapper;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
    }

    @GetMapping
    public ApiResponse<List<AuthUserView>> list() {
        List<AuthUserView> users = sysUserMapper.findAll().stream()
                .map(AuthService::toView)
                .toList();
        return ApiResponse.ok(users);
    }

    @PostMapping
    public ApiResponse<AuthUserView> create(@Valid @RequestBody CreateUserRequest req) {
        if (sysUserMapper.findByUsername(req.getUsername()) != null) {
            throw new BizException("用户名已存在");
        }
        SysUser user = new SysUser();
        user.setUsername(req.getUsername());
        user.setDisplayName(req.getDisplayName() != null ? req.getDisplayName() : req.getUsername());
        user.setPhone(req.getPhone());
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user.setRole(req.getRole() != null ? req.getRole() : "user");
        user.setEnabled(true);
        sysUserMapper.insert(user);
        auditService.log(currentActor(), "user.create", user.getUsername(), "创建用户");
        return ApiResponse.ok(AuthService.toView(user));
    }

    @PutMapping("/{id}")
    public ApiResponse<AuthUserView> update(@PathVariable Long id, @RequestBody UpdateUserRequest req) {
        SysUser user = requireUser(id);
        if (req.getDisplayName() != null) {
            user.setDisplayName(req.getDisplayName());
        }
        if (req.getPhone() != null) {
            user.setPhone(req.getPhone());
        }
        if (req.getRole() != null) {
            user.setRole(req.getRole());
        }
        if (req.getEnabled() != null) {
            user.setEnabled(req.getEnabled());
        }
        sysUserMapper.update(user);
        auditService.log(currentActor(), "user.update", user.getUsername(), "更新用户");
        return ApiResponse.ok(AuthService.toView(sysUserMapper.findById(id)));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        SysUser user = requireUser(id);
        sysUserMapper.deleteById(id);
        auditService.log(currentActor(), "user.delete", user.getUsername(), "删除用户");
        return ApiResponse.okMessage("已删除");
    }

    @PostMapping("/{id}/reset-password")
    public ApiResponse<Void> resetPassword(@PathVariable Long id, @Valid @RequestBody ResetPasswordRequest req) {
        SysUser user = requireUser(id);
        sysUserMapper.updatePassword(id, passwordEncoder.encode(req.getPassword()));
        auditService.log(currentActor(), "user.reset_password", user.getUsername(), "重置密码");
        return ApiResponse.okMessage("密码已重置");
    }

    private SysUser requireUser(Long id) {
        SysUser user = sysUserMapper.findById(id);
        if (user == null) {
            throw new BizException(404, "用户不存在");
        }
        return user;
    }

    private String currentActor() {
        return authUserDetailsService.currentUser().getUsername();
    }
}
