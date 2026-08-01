package com.anr.mineonemap.auth;

import com.anr.mineonemap.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

@Service
public class JwtService {

    public static final String CLAIM_TOKEN_TYPE = "type";
    public static final String TYPE_ACCESS = "access";
    public static final String TYPE_REFRESH = "refresh";

    private final JwtProperties jwtProperties;
    private final SecretKey secretKey;

    public JwtService(JwtProperties jwtProperties) {
        this.jwtProperties = jwtProperties;
        this.secretKey = Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String createAccessToken(String username) {
        Instant now = Instant.now();
        Instant exp = now.plus(jwtProperties.getAccessExpireMinutes(), ChronoUnit.MINUTES);
        return Jwts.builder()
                .subject(username)
                .claim(CLAIM_TOKEN_TYPE, TYPE_ACCESS)
                .issuedAt(Date.from(now))
                .expiration(Date.from(exp))
                .signWith(secretKey)
                .compact();
    }

    public String createRefreshToken(String username) {
        Instant now = Instant.now();
        Instant exp = now.plus(jwtProperties.getRefreshExpireDays(), ChronoUnit.DAYS);
        return Jwts.builder()
                .subject(username)
                .claim(CLAIM_TOKEN_TYPE, TYPE_REFRESH)
                .issuedAt(Date.from(now))
                .expiration(Date.from(exp))
                .signWith(secretKey)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public String getUsername(String token) {
        return parse(token).getSubject();
    }

    public String getTokenType(String token) {
        Object type = parse(token).get(CLAIM_TOKEN_TYPE);
        return type == null ? null : type.toString();
    }

    public long getAccessExpireSeconds() {
        return jwtProperties.getAccessExpireMinutes() * 60L;
    }
}
