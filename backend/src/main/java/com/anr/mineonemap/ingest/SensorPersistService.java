package com.anr.mineonemap.ingest;

import com.anr.mineonemap.domain.BizEnvLatest;
import com.anr.mineonemap.domain.BizRainLatest;
import com.anr.mineonemap.domain.BizSlopeLatest;
import com.anr.mineonemap.mapper.SensorPersistMapper;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 传感器读数异步落库：列式最新值 + 时序表（不再写 JSONB 整包）。
 */
@Service
public class SensorPersistService {

    private static final Logger log = LoggerFactory.getLogger(SensorPersistService.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);
    private static final DateTimeFormatter LOCAL_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final SensorPersistMapper tsMapper;
    private final SensorSchemaMapper schemaMapper;
    private final SensorConfigService configService;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "sensor-persist");
        t.setDaemon(true);
        return t;
    });

    public SensorPersistService(SensorPersistMapper tsMapper, SensorSchemaMapper schemaMapper,
                                SensorConfigService configService) {
        this.tsMapper = tsMapper;
        this.schemaMapper = schemaMapper;
        this.configService = configService;
    }

    public void persistAsync(String category, String sensorKey, String source, String topic,
                             Map<String, Object> item) {
        if (category == null || sensorKey == null || item == null) {
            return;
        }
        executor.execute(() -> {
            try {
                persistSync(category, sensorKey, source, topic, item);
            } catch (Exception e) {
                log.warn("persist {}/{} failed: {}", category, sensorKey, e.getMessage());
            }
        });
    }

    public void persistSync(String category, String sensorKey, String source, String topic,
                            Map<String, Object> item) {
        OffsetDateTime receivedAt = parseReceivedAt(item.get("receivedAt"));
        if ("meteo".equals(category)) {
            BizEnvLatest env = new BizEnvLatest();
            env.setClientId(sensorKey);
            env.setStationId(configService.resolveStationId(sensorKey));
            env.setDetectedTime(parseFlexibleTime(item.get("detectedTime")));
            env.setAmbientTemperature(asDouble(item.get("temperature")));
            env.setAmbientHumidity(asDouble(item.get("humidity")));
            env.setNoise(asDouble(item.get("noise")));
            env.setPm25(asDouble(item.get("pm25")));
            env.setPm10(asDouble(item.get("pm10")));
            env.setTsp(asDouble(item.get("dust")));
            env.setPressure(asDouble(item.get("pressure")));
            env.setWindSpeed(asDouble(item.get("windSpeed")));
            env.setRainfall(asDouble(item.get("rainfall")));
            env.setLongitude(asDouble(item.get("lng")));
            env.setLatitude(asDouble(item.get("lat")));
            env.setSource(source == null ? "http" : source);
            env.setTopic(topic);
            env.setReceivedAt(receivedAt);
            schemaMapper.upsertEnvLatest(env);
            writeEnvSamples(sensorKey, item, receivedAt);
        } else if ("gnss".equals(category)) {
            BizSlopeLatest s = new BizSlopeLatest();
            s.setDeviceSn(sensorKey);
            s.setCollectTime(parseFlexibleTime(item.get("collectTime")));
            s.setXMm(asDouble(item.get("x")));
            s.setYMm(asDouble(item.get("y")));
            s.setHMm(asDouble(item.get("h")));
            s.setDeviceType(item.get("deviceType") == null ? "2" : String.valueOf(item.get("deviceType")));
            s.setSource(source == null ? "mqtt" : source);
            s.setTopic(topic);
            s.setReceivedAt(receivedAt);
            schemaMapper.upsertSlopeLatest(s);
            writeSlopeSample(sensorKey, item, receivedAt);
        } else if ("rainfall".equals(category)) {
            BizRainLatest r = new BizRainLatest();
            r.setDeviceSn(sensorKey);
            r.setCollectTime(parseFlexibleTime(item.get("collectTime")));
            r.setRainHour(asDouble(item.get("rainHour")));
            r.setRainDay(asDouble(item.get("rainDay")));
            Object err = item.get("errcode");
            if (err instanceof Number) {
                r.setErrcode(((Number) err).intValue());
            }
            r.setDevChx(item.get("devChx") == null ? null : String.valueOf(item.get("devChx")));
            r.setSource(source == null ? "mqtt" : source);
            r.setTopic(topic);
            r.setReceivedAt(receivedAt);
            schemaMapper.upsertRainLatest(r);
            writeRainAsEnv(sensorKey, item, receivedAt);
        }
    }

    private void writeEnvSamples(String key, Map<String, Object> item, OffsetDateTime at) {
        for (String metric : new String[]{"temperature", "humidity", "noise", "pm25", "pm10", "dust"}) {
            Object v = item.get(metric);
            if (v instanceof Number) {
                tsMapper.insertEnvSample(key, metric, ((Number) v).doubleValue(), at);
            }
        }
    }

    private void writeRainAsEnv(String key, Map<String, Object> item, OffsetDateTime at) {
        Object hour = item.get("rainHour");
        Object day = item.get("rainDay");
        if (hour instanceof Number) {
            tsMapper.insertEnvSample(key, "rainHour", ((Number) hour).doubleValue(), at);
        }
        if (day instanceof Number) {
            tsMapper.insertEnvSample(key, "rainDay", ((Number) day).doubleValue(), at);
        }
    }

    private void writeSlopeSample(String key, Map<String, Object> item, OffsetDateTime at) {
        Double x = asDouble(item.get("x"));
        Double y = asDouble(item.get("y"));
        Double h = asDouble(item.get("h"));
        Double mag = null;
        if (x != null && y != null) {
            mag = Math.sqrt(x * x + y * y);
        }
        tsMapper.insertSlopeSample(key, x, y, h, mag, at);
    }

    private static Double asDouble(Object v) {
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        return null;
    }

    private static OffsetDateTime parseReceivedAt(Object v) {
        OffsetDateTime t = parseFlexibleTime(v);
        return t != null ? t : OffsetDateTime.now(TZ8);
    }

    private static OffsetDateTime parseFlexibleTime(Object v) {
        if (v == null) {
            return null;
        }
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(s);
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(s, LOCAL_FMT).atOffset(TZ8);
        } catch (Exception e) {
            return null;
        }
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdown();
        try {
            executor.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
