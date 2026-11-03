package com.anr.mineonemap.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "mine.db-backup")
public class DbBackupProperties {
    /** 与 EnvRetentionCleaner 同日触发时是否先备份 */
    private boolean enabled = true;
    /** 备份目录（自定义格式 .dump） */
    private String dir = "D:/MineOneMap/backup/db";
    /** pg_dump 可执行文件；空则自动探测 */
    private String pgDump = "";
    /** 保留最近几天的备份文件，超期删除 */
    private int keepDays = 14;
    /** pg_dump 超时（秒） */
    private int timeoutSec = 600;
}
