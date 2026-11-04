package com.anr.mineonemap.ingest.bdlx;

/** 自动识别失败时把当前验证码图交给后台人工填写（算式结果）。 */
public class BdlxCaptchaRequired extends RuntimeException {
    private final String uuid;
    private final String img;

    public BdlxCaptchaRequired(String message, String uuid, String img) {
        super(message);
        this.uuid = uuid;
        this.img = img;
    }

    public String getUuid() {
        return uuid;
    }

    public String getImg() {
        return img;
    }
}
