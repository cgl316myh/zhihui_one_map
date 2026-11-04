package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

/** 边坡位移时序抽样行（弹窗/侧栏短历史） */
public class TsSlopeSampleRow {
    private OffsetDateTime sampledAt;
    private Double x;
    private Double y;
    private Double h;

    public OffsetDateTime getSampledAt() {
        return sampledAt;
    }

    public void setSampledAt(OffsetDateTime sampledAt) {
        this.sampledAt = sampledAt;
    }

    public Double getX() {
        return x;
    }

    public void setX(Double x) {
        this.x = x;
    }

    public Double getY() {
        return y;
    }

    public void setY(Double y) {
        this.y = y;
    }

    public Double getH() {
        return h;
    }

    public void setH(Double h) {
        this.h = h;
    }
}
