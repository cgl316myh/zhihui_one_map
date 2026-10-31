package com.anr.mineonemap.ingest.ftenv;

import com.anr.mineonemap.config.FtEnvProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * ThingsBoard：POST /api/auth/login + 设备列表 + 遥测。Token 只放内存。
 */
@Component
public class FtEnvVendorClient {

    private static final Logger log = LoggerFactory.getLogger(FtEnvVendorClient.class);
    static final String TS_KEYS =
            "ambientHumidity,ambientTemperature,noise,pow,pressure,RSSI,PM10,windSpeed,windDirection,PM25,WS";

    private final FtEnvProperties props;
    private final ObjectMapper mapper;
    private final RestTemplate http;
    private final AtomicReference<String> token = new AtomicReference<>();

    public FtEnvVendorClient(FtEnvProperties props, ObjectMapper mapper) {
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

    public void login() {
        String user = props.getUsername() == null ? "" : props.getUsername().trim();
        String pass = props.getPassword() == null ? "" : props.getPassword();
        if (user.isEmpty() || pass.isEmpty()) {
            throw new IllegalStateException("未配置 mine.ftenv.username / password");
        }
        ObjectNode body = mapper.createObjectNode();
        body.put("username", user);
        body.put("password", pass);
        JsonNode resp = exchange("/api/auth/login", HttpMethod.POST, body, false);
        String t = firstNonBlank(text(resp, "token"), text(resp.path("data"), "token"));
        if (t.isEmpty()) {
            throw new IllegalStateException("环境云登录无 token：" + resp.toString().substring(0,
                    Math.min(180, resp.toString().length())));
        }
        token.set(t.trim());
        log.info("FT env cloud login ok");
    }

    public JsonNode currentUser() {
        return getAuth("/api/auth/user/");
    }

    public List<JsonNode> listDevices() {
        JsonNode user = currentUser();
        String customerId = firstNonBlank(
                text(user.path("customerId"), "id"),
                text(user, "customerId"));
        JsonNode page;
        if (!customerId.isEmpty()) {
            page = getAuth("/api/customer/" + customerId + "/deviceInfos?pageSize=1000&page=0");
        } else {
            page = getAuth("/api/tenant/deviceInfos?pageSize=1000&page=0");
        }
        List<JsonNode> out = new ArrayList<>();
        if (page.path("data").isArray()) {
            page.get("data").forEach(out::add);
        }
        return out;
    }

    public JsonNode latestTimeseries(String deviceId) {
        return getAuth("/api/plugins/telemetry/DEVICE/" + deviceId + "/values/timeseries?keys=" + TS_KEYS);
    }

    public JsonNode historyTimeseries(String deviceId, long startTs, long endTs) {
        String q = "/api/plugins/telemetry/DEVICE/" + deviceId
                + "/values/timeseries?keys=" + TS_KEYS
                + "&startTs=" + startTs + "&endTs=" + endTs
                + "&interval=3600000&agg=AVG&limit=2000";
        return getAuth(q);
    }

    private JsonNode getAuth(String path) {
        return exchange(path, HttpMethod.GET, null, true);
    }

    private JsonNode exchange(String path, HttpMethod method, JsonNode body, boolean auth) {
        String url = join(props.getApiBase(), path);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON, MediaType.ALL));
        headers.set(HttpHeaders.USER_AGENT, "Mozilla/5.0 MineOneMap");
        headers.set(HttpHeaders.ORIGIN, originOf(props.getWebUrl()));
        headers.set(HttpHeaders.REFERER, originOf(props.getWebUrl()) + "/");
        if (auth) {
            String t = ensureToken();
            headers.set("X-Authorization", "Bearer " + t);
            headers.set(HttpHeaders.AUTHORIZATION, "Bearer " + t);
        }
        HttpEntity<String> entity = body == null
                ? new HttpEntity<>(headers)
                : new HttpEntity<>(body.toString(), headers);
        ResponseEntity<String> resp = http.exchange(url, method, entity, String.class);
        int status = resp.getStatusCode().value();
        String raw = resp.getBody() == null ? "{}" : resp.getBody();
        if (auth && (status == 401 || status == 403)) {
            invalidateToken();
            throw new IllegalStateException("环境云未授权 HTTP " + status);
        }
        if (status >= 400) {
            throw new IllegalStateException("环境云 HTTP " + status + " " + url + " "
                    + raw.substring(0, Math.min(180, raw.length())));
        }
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException("环境云非 JSON " + url + " "
                    + raw.substring(0, Math.min(180, raw.length())));
        }
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

    private static String originOf(String webUrl) {
        if (webUrl == null || webUrl.isBlank()) {
            return "http://182.40.193.119:9010";
        }
        try {
            java.net.URI u = java.net.URI.create(webUrl.trim());
            if (u.getScheme() != null && u.getHost() != null) {
                int port = u.getPort();
                return u.getScheme() + "://" + u.getHost() + (port > 0 ? ":" + port : "");
            }
        } catch (Exception ignored) {
            /* fallback */
        }
        return "http://182.40.193.119:9010";
    }
}
