package com.anr.mineonemap.ingest.ftenv;

import com.anr.mineonemap.config.FtEnvProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class FtEnvPullScheduler {

    private static final Logger log = LoggerFactory.getLogger(FtEnvPullScheduler.class);

    private final FtEnvProperties props;
    private final FtEnvPullService pullService;

    public FtEnvPullScheduler(FtEnvProperties props, FtEnvPullService pullService) {
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
                Thread.sleep(40_000);
                pullService.pullOnce();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                log.warn("FT env startup pull: {}", e.getMessage());
            }
        }, "ftenv-first-pull");
        t.setDaemon(true);
        t.start();
    }

    @Scheduled(cron = "${mine.ftenv.cron:0 18 * * * *}")
    public void hourly() {
        if (!props.isEnabled()) {
            return;
        }
        try {
            pullService.pullOnce();
        } catch (Exception e) {
            log.warn("FT env hourly pull: {}", e.getMessage());
        }
    }
}
