package com.anr.mineonemap.admin;

import com.anr.mineonemap.domain.SysAuditLog;
import com.anr.mineonemap.mapper.SysAuditLogMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Service
public class AuditService {

    private final SysAuditLogMapper auditLogMapper;

    public AuditService(SysAuditLogMapper auditLogMapper) {
        this.auditLogMapper = auditLogMapper;
    }

    public void log(String actor, String action, String target, String summary) {
        SysAuditLog log = new SysAuditLog();
        log.setActor(actor);
        log.setAction(action);
        log.setTarget(target);
        log.setResult("ok");
        log.setSummary(summary);
        log.setIp(resolveClientIp());
        auditLogMapper.insert(log);
    }

    private String resolveClientIp() {
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs == null) {
            return null;
        }
        HttpServletRequest request = attrs.getRequest();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
