package com.anr.mineonemap.ingest;

import com.anr.mineonemap.domain.BizEnvLatest;
import com.anr.mineonemap.domain.BizRainLatest;
import com.anr.mineonemap.domain.BizSlopeLatest;
import com.anr.mineonemap.mapper.SensorSchemaMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 启动时从列式最新值表回填内存。
 */
@Component
@Order(150)
public class SensorWarmupRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SensorWarmupRunner.class);

    private final SensorSchemaMapper schemaMapper;
    private final SensorLatestStore store;

    public SensorWarmupRunner(SensorSchemaMapper schemaMapper, SensorLatestStore store) {
        this.schemaMapper = schemaMapper;
        this.store = store;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            int n = 0;
            List<BizEnvLatest> envs = schemaMapper.listEnvLatest();
            if (envs != null) {
                for (BizEnvLatest row : envs) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", row.getClientId());
                    item.put("clientId", row.getClientId());
                    item.put("temperature", row.getAmbientTemperature());
                    item.put("humidity", row.getAmbientHumidity());
                    item.put("noise", row.getNoise());
                    item.put("pm25", row.getPm25());
                    item.put("pm10", row.getPm10());
                    item.put("dust", row.getTsp());
                    item.put("pressure", row.getPressure());
                    item.put("windSpeed", row.getWindSpeed());
                    item.put("rainfall", row.getRainfall());
                    item.put("lng", row.getLongitude());
                    item.put("lat", row.getLatitude());
                    item.put("source", row.getSource());
                    item.put("topic", row.getTopic());
                    if (row.getDetectedTime() != null) {
                        item.put("detectedTime", row.getDetectedTime().toString());
                    }
                    if (row.getReceivedAt() != null) {
                        item.put("receivedAt", row.getReceivedAt().toString());
                    }
                    store.restoreMeteo(row.getClientId(), item);
                    n++;
                }
            }
            List<BizSlopeLatest> slopes = schemaMapper.listSlopeLatest();
            if (slopes != null) {
                for (BizSlopeLatest row : slopes) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("deviceSn", row.getDeviceSn());
                    item.put("x", row.getXMm());
                    item.put("y", row.getYMm());
                    item.put("h", row.getHMm());
                    item.put("deviceType", row.getDeviceType());
                    item.put("source", row.getSource());
                    item.put("topic", row.getTopic());
                    if (row.getCollectTime() != null) {
                        item.put("collectTime", row.getCollectTime().toString());
                    }
                    if (row.getReceivedAt() != null) {
                        item.put("receivedAt", row.getReceivedAt().toString());
                    }
                    store.restoreGnss(row.getDeviceSn(), item);
                    n++;
                }
            }
            List<BizRainLatest> rains = schemaMapper.listRainLatest();
            if (rains != null) {
                for (BizRainLatest row : rains) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("deviceSn", row.getDeviceSn());
                    item.put("rainHour", row.getRainHour());
                    item.put("rainDay", row.getRainDay());
                    item.put("errcode", row.getErrcode());
                    item.put("devChx", row.getDevChx());
                    item.put("source", row.getSource());
                    item.put("topic", row.getTopic());
                    if (row.getCollectTime() != null) {
                        item.put("collectTime", row.getCollectTime().toString());
                    }
                    if (row.getReceivedAt() != null) {
                        item.put("receivedAt", row.getReceivedAt().toString());
                    }
                    store.restoreRain(row.getDeviceSn(), item);
                    n++;
                }
            }
            if (n > 0) {
                log.info("Warmed sensor memory from columnar latest: {} rows", n);
            }
        } catch (Exception e) {
            log.warn("Sensor warmup skipped: {}", e.getMessage());
        }
    }
}
