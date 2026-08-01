package com.anr.mineonemap.auth;

import com.anr.mineonemap.auth.dto.*;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.SysUser;
import com.anr.mineonemap.mapper.SysUserMapper;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
public class AuthService {

    private final SysUserMapper sysUserMapper;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final AuthUserDetailsService authUserDetailsService;

    public AuthService(SysUserMapper sysUserMapper, JwtService jwtService,
                       PasswordEncoder passwordEncoder, AuthenticationManager authenticationManager,
                       AuthUserDetailsService authUserDetailsService) {
        this.sysUserMapper = sysUserMapper;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.authUserDetailsService = authUserDetailsService;
    }

    public TokenResponse login(LoginRequest req) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(req.getUsername(), req.getPassword()));
        SysUser user = sysUserMapper.findByUsername(req.getUsername());
        sysUserMapper.updateLastLogin(user.getId(), Instant.now());
        return buildTokenResponse(user);
    }

    public TokenResponse register(RegisterRequest req) {
        if (sysUserMapper.findByUsername(req.getUsername()) != null) {
            throw new BizException("用户名已存在");
        }
        SysUser user = new SysUser();
        user.setUsername(req.getUsername());
        user.setDisplayName(req.getDisplayName() != null ? req.getDisplayName() : req.getUsername());
        user.setPhone(req.getPhone());
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user.setRole("user");
        user.setEnabled(true);
        sysUserMapper.insert(user);
        return buildTokenResponse(user);
    }

    public TokenResponse refresh(RefreshRequest req) {
        String token = req.getRefreshToken();
        if (!JwtService.TYPE_REFRESH.equals(jwtService.getTokenType(token))) {
            throw new BizException(401, "无效的 refreshToken");
        }
        String username = jwtService.getUsername(token);
        SysUser user = sysUserMapper.findByUsername(username);
        if (user == null || !Boolean.TRUE.equals(user.getEnabled())) {
            throw new BizException(401, "用户不可用");
        }
        return buildTokenResponse(user);
    }

    public AuthUserView me() {
        UserPrincipal principal = authUserDetailsService.currentUser();
        SysUser user = sysUserMapper.findById(principal.getId());
        return toView(user);
    }

    private TokenResponse buildTokenResponse(SysUser user) {
        return TokenResponse.builder()
                .accessToken(jwtService.createAccessToken(user.getUsername()))
                .refreshToken(jwtService.createRefreshToken(user.getUsername()))
                .expiresIn(jwtService.getAccessExpireSeconds())
                .user(toView(user))
                .build();
    }

    public static AuthUserView toView(SysUser user) {
        return AuthUserView.builder()
                .id(user.getId())
                .username(user.getUsername())
                .displayName(user.getDisplayName())
                .phone(user.getPhone())
                .role(user.getRole())
                .enabled(user.getEnabled())
                .build();
    }
}
