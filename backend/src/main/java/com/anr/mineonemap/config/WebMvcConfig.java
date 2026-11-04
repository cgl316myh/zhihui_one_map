package com.anr.mineonemap.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 根路径进入登录页；静态资源由 Spring Boot 默认托管 classpath:/static/。
 * 离线瓦片通过 /tiles/** 映射到磁盘目录（默认 D:/MineOneMap/tiles）。
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Value("${mine.tiles.dir:D:/MineOneMap/tiles}")
    private String tilesDir;

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/", "/login.html");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String dir = tilesDir.replace('\\', '/');
        if (!dir.endsWith("/")) {
            dir = dir + "/";
        }
        registry.addResourceHandler("/tiles/**")
                .addResourceLocations("file:" + dir)
                .setCachePeriod(86400);
    }
}
