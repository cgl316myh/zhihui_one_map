package com.anr.mineonemap.admin;

import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.domain.SysAuditLog;
import com.anr.mineonemap.mapper.SysAuditLogMapper;
import lombok.Data;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/admin/audit")
public class AuditAdminController {

    private final SysAuditLogMapper auditLogMapper;

    public AuditAdminController(SysAuditLogMapper auditLogMapper) {
        this.auditLogMapper = auditLogMapper;
    }

    @GetMapping
    public ApiResponse<AuditPage> list(
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String action,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        int limit = Math.max(1, Math.min(size, 200));
        int offset = Math.max(0, page) * limit;
        List<SysAuditLog> items = auditLogMapper.list(actor, action, limit, offset);
        long total = auditLogMapper.count(actor, action);
        AuditPage result = new AuditPage();
        result.setItems(items);
        result.setTotal(total);
        result.setPage(page);
        result.setSize(limit);
        return ApiResponse.ok(result);
    }

    @Data
    public static class AuditPage {
        private List<SysAuditLog> items;
        private long total;
        private int page;
        private int size;
    }
}
