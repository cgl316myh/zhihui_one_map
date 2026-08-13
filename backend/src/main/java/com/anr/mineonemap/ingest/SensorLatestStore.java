package com.anr.mineonemap.ingest;

import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 传感器最新读数内存库（对标 sensor_bridge/_state）。
 */
@Component
public class SensorLatestStore {

    public static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);

    private final ConcurrentHashMap<String, Map<String, Object>> gnss = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Map<String, Object>> rainfall = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Map<String, Object>> meteo = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Map<String, Object>> other = new ConcurrentHashMap<>();

    private volatile String updatedAt;
    private volatile boolean mqttConnected;
    private volatile String mqttLastMessageAt;
    private volatile String mqttTopic;
    private volatile String mqttError;
    private volatile String httpLastReceiveAt;
    private final AtomicLong httpCount = new AtomicLong();
    private volatile String cloudPullLastAt;
    private volatile String cloudPullError;

    public static String nowIso() {
        return OffsetDateTime.now(TZ8).toString();
    }

    public void putGnss(String sn, Map<String, Object> item) {
        gnss.put(sn, item);
        touch(item.get("source"));
    }

    public void putRain(String sn, Map<String, Object> item) {
        rainfall.put(sn, item);
        touch(item.get("source"));
    }

    public void putMeteo(String key, Map<String, Object> item) {
        meteo.put(key, item);
        Object source = item.get("source");
        updatedAt = nowIso();
        if ("http".equals(source) || "demo".equals(source) || "cloud-pull".equals(source)) {
            httpLastReceiveAt = updatedAt;
            httpCount.incrementAndGet();
        }
        if ("mqtt".equals(source)) {
            mqttLastMessageAt = updatedAt;
        }
        if ("cloud-pull".equals(source)) {
            cloudPullLastAt = updatedAt;
        }
    }

    /** 启动回填：不增加 http/mqtt 计数 */
    public void restoreMeteo(String key, Map<String, Object> item) {
        meteo.put(key, item);
        if (item.get("receivedAt") != null) {
            updatedAt = String.valueOf(item.get("receivedAt"));
        }
    }

    public void restoreGnss(String sn, Map<String, Object> item) {
        gnss.put(sn, item);
    }

    public void restoreRain(String sn, Map<String, Object> item) {
        rainfall.put(sn, item);
    }

    public void restoreOther(String key, Map<String, Object> item) {
        other.put(key, item);
    }

    public void putOther(String key, Map<String, Object> item) {
        other.put(key, item);
        touch(item.get("source"));
    }

    private void touch(Object source) {
        updatedAt = nowIso();
        if ("mqtt".equals(source)) {
            mqttLastMessageAt = updatedAt;
        }
    }

    public Map<String, Map<String, Object>> snapshotGnss() {
        return Map.copyOf(gnss);
    }

    public Map<String, Map<String, Object>> snapshotRainfall() {
        return Map.copyOf(rainfall);
    }

    public Map<String, Map<String, Object>> snapshotMeteo() {
        return Map.copyOf(meteo);
    }

    public Map<String, Map<String, Object>> snapshotOther() {
        return Map.copyOf(other);
    }

    public void setMqttConnected(boolean connected) {
        this.mqttConnected = connected;
    }

    public void setMqttTopic(String topic) {
        this.mqttTopic = topic;
    }

    public void setMqttError(String error) {
        this.mqttError = error;
    }

    public String getUpdatedAt() {
        return updatedAt;
    }

    public boolean isMqttConnected() {
        return mqttConnected;
    }

    public String getMqttLastMessageAt() {
        return mqttLastMessageAt;
    }

    public String getMqttTopic() {
        return mqttTopic;
    }

    public String getMqttError() {
        return mqttError;
    }

    public String getHttpLastReceiveAt() {
        return httpLastReceiveAt;
    }

    public long getHttpCount() {
        return httpCount.get();
    }

    public void setCloudPullLastAt(String at) {
        this.cloudPullLastAt = at;
    }

    public void setCloudPullError(String error) {
        this.cloudPullError = error;
    }

    public String getCloudPullLastAt() {
        return cloudPullLastAt;
    }

    public String getCloudPullError() {
        return cloudPullError;
    }
}
