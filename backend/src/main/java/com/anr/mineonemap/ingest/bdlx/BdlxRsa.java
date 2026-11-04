package com.anr.mineonemap.ingest.bdlx;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

import javax.crypto.Cipher;

/**
 * 厂商前端 {@code src/utils/rsaEncrypt.js}：登录 password 用 RSA 公钥加密后再提交。
 * 明文提交会被后端当 Base64 密文解码，报 400。
 */
final class BdlxRsa {

    /** EL-ADMIN 默认公钥（与 bdlx.jgtop1.com 前端一致） */
    static final String PUBLIC_KEY_B64 =
            "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANL378k3RiZHWx5AfJqdH9xRNBmD9wGD"
                    + "2iRe41HdTNF8RUhNnHit5NpMNtGL0NPTSSpPjjI1kJfVorRvaQerUgkCAwEAAQ==";

    private static final PublicKey KEY = load();

    private BdlxRsa() {}

    static String encryptPassword(String plain) {
        if (plain == null || plain.isBlank()) {
            throw new IllegalStateException("登录密码为空");
        }
        if (looksEncrypted(plain)) {
            return plain.trim();
        }
        try {
            Cipher c = Cipher.getInstance("RSA/ECB/PKCS1Padding");
            c.init(Cipher.ENCRYPT_MODE, KEY);
            byte[] out = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("登录密码 RSA 加密失败：" + e.getMessage(), e);
        }
    }

    /** 512-bit RSA 密文 Base64 约 88 字符；已加密则不再套一层。 */
    static boolean looksEncrypted(String s) {
        String t = s.trim();
        if (t.length() < 80 || (t.length() % 4) != 0) {
            return false;
        }
        try {
            byte[] raw = Base64.getDecoder().decode(t);
            return raw.length >= 64;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static PublicKey load() {
        try {
            byte[] der = Base64.getDecoder().decode(PUBLIC_KEY_B64.replaceAll("\\s", ""));
            return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        } catch (Exception e) {
            throw new IllegalStateException("无法加载 BDLX RSA 公钥", e);
        }
    }
}
