package com.anr.mineonemap.ingest;

import com.anr.mineonemap.config.DbBackupProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 调用本机 pg_dump 做自定义格式库备份（与手工 backup 脚本一致用 -Fc）。
 */
@Service
public class DbBackupService {

    private static final Logger log = LoggerFactory.getLogger(DbBackupService.class);
    private static final ZoneOffset TZ8 = ZoneOffset.ofHours(8);
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss");
    private static final Pattern JDBC = Pattern.compile(
            "^jdbc:postgresql://([^:/]+)(?::(\\d+))?/([^?]+)");

    private final DbBackupProperties props;

    @Value("${spring.datasource.url:jdbc:postgresql://127.0.0.1:5432/zhihui_one_map}")
    private String jdbcUrl;

    @Value("${spring.datasource.username:postgres}")
    private String dbUser;

    @Value("${spring.datasource.password:}")
    private String dbPassword;

    public DbBackupService(DbBackupProperties props) {
        this.props = props;
    }

    /** @return 备份文件路径；跳过或失败时返回 null */
    public Path backupNow() {
        if (!props.isEnabled()) {
            log.info("DB backup skipped (mine.db-backup.enabled=false)");
            return null;
        }
        JdbcParts parts = parseJdbc(jdbcUrl);
        if (parts == null) {
            log.warn("DB backup skipped: cannot parse jdbc url");
            return null;
        }
        Path pgDump = resolvePgDump();
        if (pgDump == null) {
            log.warn("DB backup skipped: pg_dump not found");
            return null;
        }
        try {
            Path dir = Paths.get(props.getDir()).toAbsolutePath().normalize();
            Files.createDirectories(dir);
            String name = parts.database + "_" + LocalDateTime.now(TZ8).format(STAMP) + ".dump";
            Path out = dir.resolve(name);

            List<String> cmd = new ArrayList<>();
            cmd.add(pgDump.toString());
            cmd.add("-h");
            cmd.add(parts.host);
            cmd.add("-p");
            cmd.add(String.valueOf(parts.port));
            cmd.add("-U");
            cmd.add(dbUser == null ? "postgres" : dbUser);
            cmd.add("-d");
            cmd.add(parts.database);
            cmd.add("-Fc");
            cmd.add("-f");
            cmd.add(out.toString());

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            if (dbPassword != null && !dbPassword.isBlank()) {
                pb.environment().put("PGPASSWORD", dbPassword);
            }

            log.info("DB backup start -> {}", out);
            Process p = pb.start();
            StringBuilder output = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (output.length() < 4000) {
                        output.append(line).append('\n');
                    }
                }
            }
            int timeout = Math.max(60, props.getTimeoutSec());
            boolean finished = p.waitFor(timeout, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                safeDelete(out);
                log.error("DB backup timeout after {}s", timeout);
                return null;
            }
            int code = p.exitValue();
            if (code != 0 || !Files.isRegularFile(out) || Files.size(out) <= 0) {
                safeDelete(out);
                log.error("DB backup failed exit={} out={} detail={}", code, out, output);
                return null;
            }
            log.info("DB backup ok size={} path={}", Files.size(out), out);
            pruneOld(dir);
            return out;
        } catch (Exception e) {
            log.error("DB backup error: {}", e.getMessage());
            return null;
        }
    }

    private void pruneOld(Path dir) {
        int keepDays = Math.max(1, props.getKeepDays());
        Instant cutoff = Instant.now().minusSeconds(keepDays * 86400L);
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.dump")) {
            for (Path f : stream) {
                try {
                    Instant mt = Files.getLastModifiedTime(f).toInstant();
                    if (mt.isBefore(cutoff)) {
                        Files.deleteIfExists(f);
                        log.info("DB backup pruned {}", f.getFileName());
                    }
                } catch (Exception e) {
                    log.warn("DB backup prune {}: {}", f.getFileName(), e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("DB backup prune skipped: {}", e.getMessage());
        }
    }

    private Path resolvePgDump() {
        if (props.getPgDump() != null && !props.getPgDump().isBlank()) {
            Path p = Paths.get(props.getPgDump());
            if (Files.isRegularFile(p)) {
                return p;
            }
        }
        String[] cands = {
                "D:/Program Files/PostgreSQL/16/bin/pg_dump.exe",
                "D:/Program Files/PostgreSQL/15/bin/pg_dump.exe",
                "C:/Program Files/PostgreSQL/16/bin/pg_dump.exe",
                "C:/Program Files/PostgreSQL/15/bin/pg_dump.exe",
        };
        for (String c : cands) {
            Path p = Paths.get(c);
            if (Files.isRegularFile(p)) {
                return p;
            }
        }
        return null;
    }

    private static JdbcParts parseJdbc(String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        Matcher m = JDBC.matcher(url.trim());
        if (!m.find()) {
            return null;
        }
        JdbcParts p = new JdbcParts();
        p.host = m.group(1);
        p.port = m.group(2) == null ? 5432 : Integer.parseInt(m.group(2));
        p.database = m.group(3);
        if (p.database != null && p.database.contains("?")) {
            p.database = p.database.substring(0, p.database.indexOf('?'));
        }
        return p;
    }

    private static void safeDelete(Path out) {
        try {
            if (out != null) {
                Files.deleteIfExists(out);
            }
        } catch (Exception ignored) {
        }
    }

    private static final class JdbcParts {
        String host;
        int port;
        String database;
    }
}
