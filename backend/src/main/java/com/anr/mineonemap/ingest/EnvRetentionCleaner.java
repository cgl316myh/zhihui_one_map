package com.anr.mineonemap.ingest;

import com.anr.mineonemap.mapper.SensorSchemaMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Component
public class EnvRetentionCleaner {

    private static final Logger log = LoggerFactory.getLogger(EnvRetentionCleaner.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);

    private final SensorConfigService configService;
    private final SensorSchemaMapper schemaMapper;
    private final DbBackupService dbBackupService;

    public EnvRetentionCleaner(SensorConfigService configService, SensorSchemaMapper schemaMapper,
                               DbBackupService dbBackupService) {
        this.configService = configService;
        this.schemaMapper = schemaMapper;
        this.dbBackupService = dbBackupService;
    }

    /** 每天凌晨 3:10：先备份库，再清理过期时序 */
    @Scheduled(cron = "0 10 3 * * *")
    public void clean() {
        try {
            Path bak = dbBackupService.backupNow();
            if (bak != null) {
                log.info("Pre-retention DB backup: {}", bak);
            }
        } catch (Exception e) {
            log.warn("Pre-retention DB backup failed (continue clean): {}", e.getMessage());
        }

        int months = configService.getEnvRetentionMonths();
        OffsetDateTime before = OffsetDateTime.now(TZ8).minusMonths(months);
        int env = schemaMapper.deleteEnvSamplesBefore(before);
        int slope = schemaMapper.deleteSlopeSamplesBefore(before);
        if (env > 0 || slope > 0) {
            log.info("Retention clean: env={}, slope={}, before={}", env, slope, before);
        }
    }
}
