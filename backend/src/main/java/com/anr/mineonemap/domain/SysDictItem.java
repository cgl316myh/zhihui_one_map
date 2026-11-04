package com.anr.mineonemap.domain;

import lombok.Data;

@Data
public class SysDictItem {
    private Long id;
    private String typeCode;
    private String itemCode;
    private String label;
    private Integer sortNo;
    private Boolean enabled;
}
