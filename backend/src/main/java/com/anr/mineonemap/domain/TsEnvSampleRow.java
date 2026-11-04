package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

/** 环境/雨量时序抽样行（大屏趋势用） */
public class TsEnvSampleRow {
    private OffsetDateTime sampledAt;
    private Double value;

    public OffsetDateTime getSampledAt() {
        return sampledAt;
    }

    public void setSampledAt(OffsetDateTime sampledAt) {
        this.sampledAt = sampledAt;
    }

    public Double getValue() {
        return value;
    }

    public void setValue(Double value) {
        this.value = value;
    }
}
