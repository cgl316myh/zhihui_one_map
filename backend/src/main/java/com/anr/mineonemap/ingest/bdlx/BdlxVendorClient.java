package com.anr.mineonemap.ingest.bdlx;

import com.anr.mineonemap.config.BdlxProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 易尔 EL-ADMIN：验证码登录 + 点表/历史/告警。Token 只放内存，不落库。
 */
@Component
public class BdlxVendorClient {

    private static final Logger log = LoggerFactory.getLogger(BdlxVendorClient.class);
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final BdlxProperties props;
    private final ObjectMapper mapper;
    private final RestTemplate http;
    private final AtomicReference<String> token = new AtomicReference<>();

    public BdlxVendorClient(BdlxProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Math.max(3000, props.getConnectTimeoutMs()));
        f.setReadTimeout(Math.max(5000, props.getReadTimeoutMs()));
        this.http = new RestTemplate(f);
        this.http.setErrorHandler(new org.springframework.web.client.DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        if (props.getToken() != null && !props.getToken().isBlank()) {
            this.token.set(props.getToken().trim());
        }
    }

    public synchronized String ensureToken() {
        String cached = token.get();
        if (cached != null && !cached.isBlank()) {
            return cached;
        }
        if (props.getToken() != null && !props.getToken().isBlank()) {
            token.set(props.getToken().trim());
            return token.get();
        }
        login();
        return token.get();
    }

    public void invalidateToken() {
        token.set(null);
    }

    public JsonNode fetchCaptcha() {
        JsonNode cap = getAnonymous("/auth/code");
        if (cap != null && cap.has("data") && cap.get("data").isObject()) {
            JsonNode d = cap.get("data");
            if (d.has("img") || d.has("uuid")) {
                return d;
            }
        }
        return cap;
    }

    public void loginWithCode(String uuid, String code) {
        String user = props.getUsername() == null ? "" : props.getUsername().trim();
        String pass = props.getPassword() == null ? "" : props.getPassword();
        if (user.isEmpty() || pass.isEmpty()) {
            throw new IllegalStateException("未配置 mine.bdlx.username / password");
        }
        if (uuid == null || uuid.isBlank() || code == null || code.isBlank()) {
            throw new IllegalStateException("验证码 uuid / 计算结果不能为空");
        }
        applyLogin(user, pass, uuid.trim(), code.trim());
    }

    public void login() {
        String user = props.getUsername() == null ? "" : props.getUsername().trim();
        String pass = props.getPassword() == null ? "" : props.getPassword();
        if (user.isEmpty() || pass.isEmpty()) {
            throw new IllegalStateException("未配置 mine.bdlx.username / password（或 BDLX_TOKEN）");
        }
        Exception last = null;
        String lastUuid = null;
        String lastImg = null;
        int retries = Math.max(1, props.getLoginRetries());
        for (int i = 0; i < retries; i++) {
            try {
                JsonNode cap = fetchCaptcha();
                lastUuid = text(cap, "uuid");
                lastImg = text(cap, "img");
                if (lastImg.isEmpty() && cap.has("img")) {
                    lastImg = cap.get("img").asText("");
                }
                String answer = BdlxMathCaptcha.solveDataUri(lastImg);
                if (answer == null || answer.isBlank()) {
                    last = new IllegalStateException("验证码识别失败");
                    continue;
                }
                applyLogin(user, pass, lastUuid, answer);
                log.info("BDLX login ok, captcha={}", answer);
                return;
            } catch (BdlxCaptchaRequired e) {
                throw e;
            } catch (Exception e) {
                last = e;
                log.warn("BDLX login retry {}/{}: {}", i + 1, retries, e.getMessage());
            }
        }
        try {
            JsonNode fresh = fetchCaptcha();
            lastUuid = text(fresh, "uuid");
            lastImg = text(fresh, "img");
            if (lastImg.isEmpty() && fresh.has("img")) {
                lastImg = fresh.get("img").asText("");
            }
        } catch (Exception ignored) {
            /* 用循环里最后一张图 */
        }
        if (lastImg != null && !lastImg.isBlank()) {
            throw new BdlxCaptchaRequired(
                    "自动识别验证码失败，请填写图中算式的计算结果（如 9、48、-1）",
                    lastUuid, lastImg);
        }
        throw new IllegalStateException("BDLX 登录失败：" + (last == null ? "unknown" : last.getMessage()));
    }

    private void applyLogin(String user, String pass, String uuid, String answer) {
        ObjectNode body = mapper.createObjectNode();
        body.put("username", user);
        body.put("password", BdlxRsa.encryptPassword(pass));
        body.put("code", answer);
        body.put("uuid", uuid);
        body.put("rememberMe", false);
        JsonNode resp = postAnonymous("/auth/login", body);
        int st = resp.path("status").asInt(resp.path("code").asInt(200));
        if (st >= 400) {
            throw new IllegalStateException(resp.path("message").asText("登录失败 " + st));
        }
        String t = firstNonBlank(text(resp, "token"), text(resp.path("data"), "token"));
        if (resp.has("token") && resp.get("token").isTextual()) {
            t = resp.get("token").asText();
        } else if (resp.has("data") && resp.get("data").isTextual()) {
            t = resp.get("data").asText();
        } else if (resp.path("data").has("token")) {
            t = resp.path("data").path("token").asText();
        }
        if (t == null || t.isBlank()) {
            throw new IllegalStateException("登录无 token：" + resp.toString().substring(0,
                    Math.min(200, resp.toString().length())));
        }
        token.set(t.trim());
    }

    public JsonNode getAuth(String path) {
        return exchange(path, HttpMethod.GET, null, true);
    }

    public JsonNode postAuth(String path, JsonNode body) {
        return exchange(path, HttpMethod.POST, body, true);
    }

    public List<JsonNode> listPoints() {
        JsonNode n = getAuth("/api/basicPoint?page=0&size=200");
        List<JsonNode> list = asArray(n);
        if (list.isEmpty() && n.isObject()) {
            list = asArray(n.path("content"));
        }
        if (list.isEmpty()) {
            list = asArray(getAuth("/api/basicPoint/getPoint?page=0&size=200"));
        }
        return list;
    }

    public List<JsonNode> listHistory(long pointId, int lookbackHours) {
        LocalDateTime end = LocalDateTime.now();
        LocalDateTime start = end.minusHours(Math.max(2, lookbackHours));
        List<JsonNode> all = new ArrayList<>();
        LocalDateTime cursor = start;
        while (!cursor.isAfter(end)) {
            LocalDateTime chunkEnd = cursor.plusDays(7);
            if (chunkEnd.isAfter(end)) {
                chunkEnd = end;
            }
            ObjectNode body = mapper.createObjectNode();
            ArrayNode ids = body.putArray("ids");
            ids.add(pointId);
            body.put("startTime", cursor.format(LOCAL));
            body.put("endTime", chunkEnd.format(LOCAL));
            JsonNode resp = postAuth("/api/analysis/getHistoryData", body);
            if (resp != null && resp.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> it = resp.fields();
                while (it.hasNext()) {
                    JsonNode arr = it.next().getValue();
                    if (arr != null && arr.isArray()) {
                        arr.forEach(all::add);
                    }
                }
            }
            if (chunkEnd.equals(end)) {
                break;
            }
            cursor = chunkEnd;
        }
        return all;
    }

    public List<JsonNode> listAlarms() {
        JsonNode n = getAuth("/api/alarm/list?page=0&size=500");
        List<JsonNode> list = asArray(n);
        if (list.isEmpty()) {
            list = asArray(n.path("content"));
        }
        if (list.isEmpty()) {
            list = asArray(n.path("records"));
        }
        return list;
    }

    private JsonNode getAnonymous(String path) {
        return exchange(path, HttpMethod.GET, null, false);
    }

    private JsonNode postAnonymous(String path, JsonNode body) {
        return exchange(path, HttpMethod.POST, body, false);
    }

    private JsonNode exchange(String path, HttpMethod method, JsonNode body, boolean auth) {
        String url = join(props.getApiBase(), path);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON, MediaType.ALL));
        if (auth) {
            String t = ensureToken();
            if (!t.regionMatches(true, 0, "Bearer ", 0, 7)) {
                headers.set("Authorization", t);
            } else {
                headers.set("Authorization", t);
            }
        }
        HttpEntity<String> entity = body == null
                ? new HttpEntity<>(headers)
                : new HttpEntity<>(body.toString(), headers);
        ResponseEntity<String> resp = http.exchange(url, method, entity, String.class);
        int status = resp.getStatusCode().value();
        String raw = resp.getBody() == null ? "{}" : resp.getBody();
        if (auth && (status == 401 || status == 403)) {
            invalidateToken();
            throw new IllegalStateException("厂商接口未授权 HTTP " + status);
        }
        if (status >= 400) {
            throw new IllegalStateException("厂商接口 HTTP " + status + " " + url + " "
                    + raw.substring(0, Math.min(180, raw.length())));
        }
        try {
            JsonNode node = mapper.readTree(raw);
            int biz = node.path("status").asInt(node.path("code").asInt(0));
            if (biz == 401) {
                invalidateToken();
                throw new IllegalStateException("厂商业务未授权: " + node.path("message").asText());
            }
            return node;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("非 JSON 响应 " + url + " " + raw.substring(0, Math.min(180, raw.length())));
        }
    }

    static List<JsonNode> asArray(JsonNode n) {
        List<JsonNode> out = new ArrayList<>();
        if (n == null || n.isNull()) {
            return out;
        }
        if (n.isArray()) {
            n.forEach(out::add);
            return out;
        }
        if (n.isObject()) {
            for (String k : List.of("content", "records", "list", "data", "rows")) {
                if (n.path(k).isArray()) {
                    n.get(k).forEach(out::add);
                    return out;
                }
            }
        }
        return out;
    }

    static String text(JsonNode n, String field) {
        if (n == null || !n.has(field) || n.get(field).isNull()) {
            return "";
        }
        return n.get(field).asText("").trim();
    }

    static String firstNonBlank(String... vals) {
        if (vals == null) {
            return "";
        }
        for (String v : vals) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "";
    }

    private static String join(String base, String path) {
        String b = base == null ? "" : base.replaceAll("/+$", "");
        String p = path == null ? "" : path;
        if (!p.startsWith("/")) {
            p = "/" + p;
        }
        return b + p;
    }
}
