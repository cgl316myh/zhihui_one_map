package com.anr.mineonemap.auth;

import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.SysUser;
import com.anr.mineonemap.mapper.SysUserMapper;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class AuthUserDetailsService implements UserDetailsService {

    private final SysUserMapper sysUserMapper;

    public AuthUserDetailsService(SysUserMapper sysUserMapper) {
        this.sysUserMapper = sysUserMapper;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        SysUser user = sysUserMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在");
        }
        return toPrincipal(user);
    }

    public UserPrincipal toPrincipal(SysUser user) {
        return new UserPrincipal(
                user.getId(),
                user.getUsername(),
                user.getPasswordHash(),
                user.getRole(),
                user.getDisplayName(),
                Boolean.TRUE.equals(user.getEnabled())
        );
    }

    public UserPrincipal currentUser() {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof UserPrincipal principal)) {
            throw new BizException(401, "未登录");
        }
        return principal;
    }
}
