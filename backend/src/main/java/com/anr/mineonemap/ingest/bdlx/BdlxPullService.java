package com.anr.mineonemap.ingest.bdlx;

import com.anr.mineonemap.config.BdlxProperties;
import com.anr.mineonemap.domain.BizBdlxAlarm;
import com.anr.mineonemap.domain.BizMapPoint;
import com.anr.mineonemap.domain.CfgSlopeDevice;
import com.anr.mineonemap.ingest.SensorLatestStore;
import com.anr.mineonemap.ingest.SensorPersistService;
import com.anr.mineonemap.mapper.BizMapPointMapper;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 拉点表 + 近一个月 GNSS/雨量时序（去重）+ 告警；最新值写入 latest 表。
 */
@Service
public class BdlxPullService {

    private static final Logger log = LoggerFactory.getLogger(BdlxPullService.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    public static final String SOURCE = "bdlx-pull";

    private final BdlxProperties props;
    private final BdlxVendorClient client;
    private final SensorSchemaMapper schemaMapper;
    private final SensorPersistService persistService;
    private final SensorLatestStore store;
    private final BizMapPointMapper mapPointMapper;
    private final ObjectMapper objectMapper;

    public BdlxPullService(BdlxProperties props, BdlxVendorClient client, SensorSchemaMapper schemaMapper,
                           SensorPersistService persistService, SensorLatestStore store,
                           BizMapPointMapper mapPointMapper, ObjectMapper objectMapper) {
        this.props = props;
        this.client = client;
        this.schemaMapper = schemaMapper;
        this.persistService = persistService;
        this.store = store;
        this.mapPointMapper = mapPointMapper;
        this.objectMapper = objectMapper;
    }

    public JsonNode fetchCaptcha() {
        return client.fetchCaptcha();
    }

    public void loginWithCode(String uuid, String code) {
        client.loginWithCode(uuid, code);
    }

    public Map<String, Object> pullOnce() {
        Map<String, Object> summary = new LinkedHashMap<>();
        int points = 0;
        int samples = 0;
        int alarms = 0;
        try {
            client.ensureToken();
            List<JsonNode> pointRows;
            try {
                pointRows = client.listPoints();
            } catch (IllegalStateException e) {
                if (e.getMessage() != null && e.getMessage().contains("未授权")) {
                    client.login();
                    pointRows = client.listPoints();
                } else {
                    throw e;
                }
            }

            List<BizBdlxAlarm> alarmRows = parseAlarms(client.listAlarms());
            Map<String, BizBdlxAlarm> alarmByPoint = new LinkedHashMap<>();
            for (BizBdlxAlarm a : alarmRows) {
                schemaMapper.upsertBdlxAlarm(a);
                alarms++;
                if (a.getPointId() != null && !alarmByPoint.containsKey(a.getPointId())) {
                    alarmByPoint.put(a.getPointId(), a);
                }
            }

            int lookback = Math.max(24 * 31, props.getLookbackHours());
            for (JsonNode p : pointRows) {
                int n = applyPoint(p, alarmByPoint, lookback);
                if (n >= 0) {
                    points++;
                    samples += n;
                }
            }
            OffsetDateTime now = OffsetDateTime.now(TZ8);
            schemaMapper.updateBdlxPull(now, null, points, samples, alarms);
            store.setBdlxPullLastAt(now.toString());
            store.setBdlxPullError(null);
            summary.put("ok", true);
            summary.put("lookbackHours", lookback);
            summary.put("points", points);
            summary.put("samples", samples);
            summary.put("alarms", alarms);
            summary.put("pulledAt", now.toString());
            log.info("BDLX pull ok points={} samples={} alarms={}", points, samples, alarms);
        } catch (Exception e) {
            log.warn("BDLX pull failed: {}", e.getMessage());
            schemaMapper.updateBdlxPull(null, clip(e.getMessage()), points, samples, alarms);
            store.setBdlxPullError(clip(e.getMessage()));
            summary.put("ok", false);
            summary.put("error", e.getMessage());
            summary.put("points", points);
            summary.put("samples", samples);
            summary.put("alarms", alarms);
            throw new IllegalStateException(e.getMessage(), e);
        }
        return summary;
    }

    /** @return 写入的时序条数；点无效返回 -1 */
    private int applyPoint(JsonNode p, Map<String, BizBdlxAlarm> alarmByPoint, int lookbackHours) {
        long pointId = longVal(p, 0L, "id", "pointId", "pid");
        String sn = firstText(p, "sn", "devId", "deviceSn", "imei");
        String name = firstText(p, "name", "pointName", "label");
        if (sn.isEmpty() && pointId == 0) {
            return -1;
        }
        if (sn.isEmpty()) {
            sn = String.valueOf(pointId);
        }
        String idStr = pointId > 0 ? String.valueOf(pointId) : firstText(p, "id");
        Double lng = num(p, "longitude", "lng", "lon", "x");
        Double lat = num(p, "latitude", "lat", "y");
        Boolean online = parseOnline(p);
        String maintainer = firstText(p, "maintainer", "maintainName", "whr", "repairUser",
                "userName", "contacts", "phone", "tel");
        if (maintainer.isEmpty()) {
            String a = firstText(p, "userName");
            String b = firstText(p, "phone", "tel");
            maintainer = (a + " " + b).trim();
        }
        int type = (int) longVal(p, 0, "deviceType", "type", "dataType");
        boolean rain = type == 201 || name.contains("雨量") || "rainfall".equalsIgnoreCase(firstText(p, "sensorType"));

        upsertDevice(sn, idStr, name, rain);
        upsertMapPoint(idStr, name, sn, rain, lng, lat, maintainer, online);

        List<JsonNode> hist = List.of();
        if (pointId > 0) {
            try {
                hist = client.listHistory(pointId, lookbackHours);
            } catch (Exception e) {
                log.warn("history {} failed: {}", pointId, e.getMessage());
            }
        }
        hist = new ArrayList<>(hist);
        hist.sort((a, b) -> recTime(a).compareTo(recTime(b)));
        BizBdlxAlarm alarm = alarmByPoint.get(idStr);
        int n = 0;
        JsonNode last = hist.isEmpty() ? null : hist.get(hist.size() - 1);
        for (JsonNode rec : hist) {
            boolean newest = rec == last;
            if (rain) {
                persistRain(sn, idStr, lng, lat, online, maintainer, rec, newest);
            } else {
                persistGnss(sn, idStr, lng, lat, online, maintainer, rec, alarm, newest);
            }
            n++;
        }
        if (hist.isEmpty()) {
            if (rain) {
                persistRain(sn, idStr, lng, lat, online, maintainer, null, true);
            } else {
                persistGnss(sn, idStr, lng, lat, online, maintainer, null, alarm, true);
            }
        }
        return n;
    }

    private static String recTime(JsonNode rec) {
        return firstText(rec, "calculatingTime", "uploadTime", "createTime");
    }

    private void persistGnss(String sn, String pointId, Double lng, Double lat, Boolean online,
                             String maintainer, JsonNode hist, BizBdlxAlarm alarm, boolean updateLive) {
        OffsetDateTime collect = hist == null ? null : parseTime(firstText(hist, "calculatingTime", "uploadTime"));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        item.put("x", hist == null ? null : num(hist, "totalX", "x"));
        item.put("y", hist == null ? null : num(hist, "totalY", "y"));
        item.put("h", hist == null ? null : num(hist, "totalH", "h", "z"));
        item.put("plane", hist == null ? null : num(hist, "totalPlaneDisplacement"));
        item.put("planeSpeed", hist == null ? null : num(hist, "planeSpeed"));
        item.put("planeAcc", hist == null ? null : num(hist, "planeAccelerated"));
        item.put("azimuth", hist == null ? null : num(hist, "azimuth"));
        item.put("totalProjection", hist == null ? null : num(hist, "totalProjection"));
        item.put("speedX", hist == null ? null : num(hist, "speedX"));
        item.put("speedY", hist == null ? null : num(hist, "speedY"));
        item.put("speedH", hist == null ? null : num(hist, "speedH"));
        item.put("projectionSpeed", hist == null ? null : num(hist, "projectionSpeed"));
        item.put("projectionAcc", hist == null ? null : num(hist, "projectionAccelerated"));
        item.put("intervalHours", hist == null ? null : num(hist, "intervalTime"));
        item.put("lon", lng);
        item.put("lat", lat);
        item.put("online", online);
        item.put("maintainer", blankToNull(maintainer));
        item.put("vendorPointId", pointId);
        if (alarm != null) {
            item.put("vendorColor", alarm.getColor());
            item.put("alarmText", alarm.getTitle());
        }
        item.put("deviceType", "204");
        item.put("source", SOURCE);
        item.put("collectTime", collect == null ? null : collect.toString());
        item.put("receivedAt", SensorLatestStore.nowIso());
        if (updateLive) {
            store.putGnss(sn, item);
        }
        persistService.persistSync("gnss", sn, SOURCE, null, item);
    }

    private void persistRain(String sn, String pointId, Double lng, Double lat, Boolean online,
                             String maintainer, JsonNode hist, boolean updateLive) {
        OffsetDateTime collect = hist == null ? null : parseTime(firstText(hist, "calculatingTime", "uploadTime"));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("deviceSn", sn);
        Double hour = hist == null ? null : num(hist, "observation", "rainHour", "hourRain");
        item.put("rainHour", hour);
        item.put("rainDay", hist == null ? null : num(hist, "rainDay", "dayRain"));
        item.put("lon", lng);
        item.put("lat", lat);
        item.put("online", online);
        item.put("maintainer", blankToNull(maintainer));
        item.put("vendorPointId", pointId);
        item.put("source", SOURCE);
        item.put("collectTime", collect == null ? null : collect.toString());
        item.put("receivedAt", SensorLatestStore.nowIso());
        if (updateLive) {
            store.putRain(sn, item);
        }
        persistService.persistSync("rainfall", sn, SOURCE, null, item);
    }

    private void upsertDevice(String sn, String pointId, String name, boolean rain) {
        CfgSlopeDevice d = new CfgSlopeDevice();
        d.setDeviceSn(sn);
        d.setExternalId(pointId);
        d.setName(name == null || name.isBlank() ? sn : name);
        d.setDeviceKind(rain ? "rainfall" : "displacement");
        d.setEnabled(true);
        schemaMapper.insertSlopeDevice(d);
    }

    private void upsertMapPoint(String id, String name, String sn, boolean rain, Double lng, Double lat,
                                String maintainer, Boolean online) {
        if (id == null || id.isBlank()) {
            return;
        }
        BizMapPoint point = new BizMapPoint();
        point.setId(id);
        point.setName(name == null || name.isBlank() ? sn : name);
        point.setType(rain ? "rainfall" : "displacement");
        point.setLng(lng);
        point.setLat(lat);
        point.setExternalId(sn);
        ObjectNode extra = objectMapper.createObjectNode();
        extra.put("sn", sn);
        extra.put("sensorType", rain ? "雨量计" : "GNSS");
        extra.put("deviceType", rain ? 201 : 204);
        if (maintainer != null && !maintainer.isBlank()) {
            extra.put("maintainer", maintainer);
        }
        if (online != null) {
            extra.put("online", online);
        }
        extra.put("source", SOURCE);
        try {
            point.setExtra(objectMapper.writeValueAsString(extra));
        } catch (Exception e) {
            point.setExtra("{}");
        }
        mapPointMapper.upsert(point);
    }

    private List<BizBdlxAlarm> parseAlarms(List<JsonNode> rows) {
        List<BizBdlxAlarm> out = new ArrayList<>();
        for (JsonNode n : rows) {
            long id = longVal(n, 0, "id", "alarmId");
            if (id == 0) {
                continue;
            }
            BizBdlxAlarm a = new BizBdlxAlarm();
            a.setVendorId(id);
            a.setPointId(firstText(n, "pointId", "pid", "basicPointId"));
            if (a.getPointId().isEmpty() && n.path("point").has("id")) {
                a.setPointId(n.path("point").path("id").asText());
            }
            a.setDeviceSn(firstText(n, "sn", "devId", "deviceSn"));
            String colorRaw = firstText(n, "color", "warnColor", "levelName", "alarmColor", "typeName", "level");
            a.setColor(normalizeColor(colorRaw));
            a.setLevel(colorToLevel(a.getColor()));
            String title = firstText(n, "title", "content", "message", "msg", "alarmContent", "remark");
            a.setTitle(title.length() > 250 ? title.substring(0, 250) : title);
            a.setContent(firstText(n, "content", "message", "msg", "alarmContent", "dealContent"));
            a.setStatus(firstText(n, "status", "state", "handleStatus", "alarmStatus"));
            a.setAlarmTime(parseTime(firstText(n, "createTime", "alarmTime", "time", "gmtCreate")));
            try {
                a.setRaw(objectMapper.writeValueAsString(n));
            } catch (Exception e) {
                a.setRaw("{}");
            }
            out.add(a);
        }
        out.sort((a, b) -> {
            OffsetDateTime ta = a.getAlarmTime();
            OffsetDateTime tb = b.getAlarmTime();
            if (ta == null && tb == null) {
                return Long.compare(b.getVendorId(), a.getVendorId());
            }
            if (ta == null) {
                return 1;
            }
            if (tb == null) {
                return -1;
            }
            return tb.compareTo(ta);
        });
        return out;
    }

    static String normalizeColor(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if (s.contains("红") || s.contains("red") || "1".equals(s) || "4".equals(s)) {
            return "red";
        }
        if (s.contains("橙") || s.contains("orange") || "2".equals(s)) {
            return "orange";
        }
        if (s.contains("黄") || s.contains("yellow") || "3".equals(s)) {
            return "yellow";
        }
        if (s.contains("蓝") || s.contains("blue") || "0".equals(s)) {
            return "blue";
        }
        return s;
    }

    static String colorToLevel(String color) {
        return switch (color == null ? "" : color) {
            case "red" -> "alarm";
            case "orange", "yellow" -> "warn";
            default -> "info";
        };
    }

    private static Boolean parseOnline(JsonNode p) {
        if (p.has("online") && p.get("online").isBoolean()) {
            return p.get("online").asBoolean();
        }
        String s = firstText(p, "status", "state", "isOnline", "online");
        if (s.isEmpty()) {
            return null;
        }
        String t = s.toLowerCase(Locale.ROOT);
        if (t.contains("离") || "0".equals(t) || "false".equals(t) || "offline".equals(t)) {
            return false;
        }
        if (t.contains("在") || "1".equals(t) || "true".equals(t) || "online".equals(t)) {
            return true;
        }
        return null;
    }

    private static OffsetDateTime parseTime(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        String t = s.trim();
        try {
            return OffsetDateTime.parse(t);
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(t, LOCAL).atOffset(TZ8);
        } catch (Exception e) {
            return null;
        }
    }

    private static String firstText(JsonNode n, String... fields) {
        if (n == null) {
            return "";
        }
        for (String f : fields) {
            if (n.has(f) && !n.get(f).isNull()) {
                String v = n.get(f).asText("").trim();
                if (!v.isEmpty() && !"null".equalsIgnoreCase(v)) {
                    return v;
                }
            }
        }
        return "";
    }

    private static Double num(JsonNode n, String... fields) {
        if (n == null) {
            return null;
        }
        for (String f : fields) {
            if (!n.has(f) || n.get(f).isNull()) {
                continue;
            }
            JsonNode v = n.get(f);
            if (v.isNumber()) {
                return v.asDouble();
            }
            try {
                String s = v.asText("").trim();
                if (!s.isEmpty()) {
                    return Double.parseDouble(s);
                }
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private static long longVal(JsonNode n, long dft, String... fields) {
        Double v = num(n, fields);
        return v == null ? dft : v.longValue();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static String clip(String s) {
        if (s == null) {
            return null;
        }
        return s.length() <= 500 ? s : s.substring(0, 500);
    }
}
