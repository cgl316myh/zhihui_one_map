package com.anr.mineonemap.admin;

import com.anr.mineonemap.auth.AuthUserDetailsService;
import com.anr.mineonemap.common.ApiResponse;
import com.anr.mineonemap.common.BizException;
import com.anr.mineonemap.domain.SysDictItem;
import com.anr.mineonemap.domain.SysDictType;
import com.anr.mineonemap.mapper.SysDictMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin/dict")
public class DictAdminController {

    private final SysDictMapper sysDictMapper;
    private final AuditService auditService;
    private final AuthUserDetailsService authUserDetailsService;

    public DictAdminController(SysDictMapper sysDictMapper, AuditService auditService,
                               AuthUserDetailsService authUserDetailsService) {
        this.sysDictMapper = sysDictMapper;
        this.auditService = auditService;
        this.authUserDetailsService = authUserDetailsService;
    }

    @GetMapping("/types")
    public ApiResponse<List<SysDictType>> types() {
        return ApiResponse.ok(sysDictMapper.listTypes());
    }

    @GetMapping("/items")
    public ApiResponse<List<SysDictItem>> items(@RequestParam("type") String type) {
        return ApiResponse.ok(sysDictMapper.listItemsByType(type));
    }

    @PostMapping("/items")
    public ApiResponse<SysDictItem> createItem(@Valid @RequestBody DictItemRequest req) {
        SysDictItem item = new SysDictItem();
        item.setTypeCode(req.getTypeCode());
        item.setItemCode(req.getItemCode());
        item.setLabel(req.getLabel());
        item.setSortNo(req.getSortNo() != null ? req.getSortNo() : 0);
        item.setEnabled(req.getEnabled() != null ? req.getEnabled() : true);
        sysDictMapper.insertItem(item);
        auditService.log(currentActor(), "dict.item.create", req.getTypeCode() + "/" + req.getItemCode(), "新增字典项");
        return ApiResponse.ok(sysDictMapper.findItemById(item.getId()));
    }

    @PutMapping("/items/{id}")
    public ApiResponse<SysDictItem> updateItem(@PathVariable Long id, @RequestBody DictItemUpdateRequest req) {
        SysDictItem item = requireItem(id);
        if (req.getLabel() != null) {
            item.setLabel(req.getLabel());
        }
        if (req.getSortNo() != null) {
            item.setSortNo(req.getSortNo());
        }
        if (req.getEnabled() != null) {
            item.setEnabled(req.getEnabled());
        }
        sysDictMapper.updateItem(item);
        auditService.log(currentActor(), "dict.item.update", item.getTypeCode() + "/" + item.getItemCode(), "更新字典项");
        return ApiResponse.ok(sysDictMapper.findItemById(id));
    }

    @DeleteMapping("/items/{id}")
    public ApiResponse<Void> deleteItem(@PathVariable Long id) {
        SysDictItem item = requireItem(id);
        sysDictMapper.deleteItem(id);
        auditService.log(currentActor(), "dict.item.delete", item.getTypeCode() + "/" + item.getItemCode(), "删除字典项");
        return ApiResponse.okMessage("已删除");
    }

    private SysDictItem requireItem(Long id) {
        SysDictItem item = sysDictMapper.findItemById(id);
        if (item == null) {
            throw new BizException(404, "字典项不存在");
        }
        return item;
    }

    private String currentActor() {
        return authUserDetailsService.currentUser().getUsername();
    }

    @Data
    public static class DictItemRequest {
        @NotBlank
        private String typeCode;
        @NotBlank
        private String itemCode;
        @NotBlank
        private String label;
        private Integer sortNo;
        private Boolean enabled;
    }

    @Data
    public static class DictItemUpdateRequest {
        private String label;
        private Integer sortNo;
        private Boolean enabled;
    }
}
