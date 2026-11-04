package com.anr.mineonemap.ingest;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 可选：按配置间隔（默认 ≥30s）自动注入与「测试推送」同结构的模拟环境数据。
 * 需同时打开 ingest.enabled 与 ingest.demoPushEnabled。
 * <p>
 * 说明：这是本机模拟写入（演示），不是向厂商主动拉取；真实数据仍靠 HTTP/MQTT。
 */
@Component
public class SensorDemoPushScheduler {

    private static final Logger log = LoggerFactory.getLogger(SensorDemoPushScheduler.class);
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final ZoneId TZ = ZoneId.of("Asia/Shanghai");

    private final SensorConfigService configService;
    private final SensorPayloadIngestor ingestor;
    private final ObjectMapper objectMapper;
    private volatile long lastFireMs;

    public SensorDemoPushScheduler(SensorConfigService configService, SensorPayloadIngestor ingestor,
                                   ObjectMapper objectMapper) {
        this.configService = configService;
        this.ingestor = ingestor;
        this.objectMapper = objectMapper;
    }

    @Scheduled(fixedDelay = 5000)
    public void tick() {
        if (!configService.isIngestEnabled() || !configService.isDemoPushEnabled()) {
            return;
        }
        long intervalMs = configService.getDemoPushIntervalSec() * 1000L;
        long now = System.currentTimeMillis();
        if (now - lastFireMs < intervalMs) {
            return;
        }
        lastFireMs = now;
        try {
            ObjectNode n = objectMapper.createObjectNode();
            ThreadLocalRandom r = ThreadLocalRandom.current();
            n.put("clientId", "Pczd8HKi3MdgGTW6SAeB");
            n.put("ambientTemperature", round1(24 + r.nextDouble() * 6));
            n.put("ambientHumidity", round1(45 + r.nextDouble() * 25));
            n.put("noise", round1(42 + r.nextDouble() * 18));
            n.put("PM2.5", round1(12 + r.nextDouble() * 30));
            n.put("PM10", round1(20 + r.nextDouble() * 40));
            n.put("pressure", round1(1005 + r.nextDouble() * 15));
            n.put("detectedTime", LocalDateTime.now(TZ).format(FMT));
            n.put("longitude", 102.44505);
            n.put("latitude", 24.78545);
            boolean ok = ingestor.ingest(n, "http");
            if (ok) {
                log.info("demo auto-push ok T={} noise={}",
                        n.get("ambientTemperature").asDouble(), n.get("noise").asDouble());
            }
        } catch (Exception e) {
            log.warn("demo push failed: {}", e.getMessage());
        }
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
