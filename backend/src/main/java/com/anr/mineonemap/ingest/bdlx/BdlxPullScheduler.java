package com.anr.mineonemap.ingest.bdlx;

import com.anr.mineonemap.config.BdlxProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 启动约 25 秒后拉一次，之后按 cron 每小时拉最新值。
 */
@Component
public class BdlxPullScheduler {

    private static final Logger log = LoggerFactory.getLogger(BdlxPullScheduler.class);

    private final BdlxProperties props;
    private final BdlxPullService pullService;

    public BdlxPullScheduler(BdlxProperties props, BdlxPullService pullService) {
        this.props = props;
        this.pullService = pullService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        if (!props.isEnabled()) {
            return;
        }
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(25_000);
                pullService.pullOnce();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                log.warn("BDLX startup pull: {}", e.getMessage());
            }
        }, "bdlx-first-pull");
        t.setDaemon(true);
        t.start();
    }

    @Scheduled(cron = "${mine.bdlx.cron:0 8 * * * *}")
    public void hourly() {
        if (!props.isEnabled()) {
            return;
        }
        try {
            pullService.pullOnce();
        } catch (Exception e) {
            log.warn("BDLX hourly pull: {}", e.getMessage());
        }
    }
}
