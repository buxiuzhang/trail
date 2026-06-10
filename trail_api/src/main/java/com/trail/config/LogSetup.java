package com.trail.config;

import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.rolling.RollingFileAppender;
import ch.qos.logback.core.rolling.TimeBasedRollingPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 按天滚动文件日志配置。
 *
 * 由 {@link DataDirService#switchTo(String)} 和 {@link StartupChecks#run()}
 * 在数据目录就绪后调用，将运行日志写入 {@code <dataDir>/logs/}。
 *
 * 日志格式：trail-YYYY-MM-DD.log（保留 30 天），方便用户按天排查。
 */
public class LogSetup {
    private static final Logger log = LoggerFactory.getLogger(LogSetup.class);
    private static final String FILE_APPENDER_NAME = "TRAIL_FILE";

    private LogSetup() {}

    /**
     * 将文件日志挂到 ROOT logger。
     *
     * @param logDir {@code <dataDir>/logs} 目录
     */
    public static void configureFileAppender(Path logDir) {
        try {
            Files.createDirectories(logDir);
        } catch (IOException e) {
            org.slf4j.LoggerFactory.getLogger(LogSetup.class)
                    .warn("无法创建日志目录 {}: {}", logDir, e.getMessage());
            return;
        }

        LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();

        // 移除旧的文件 appender（数据目录切换时）
        ch.qos.logback.classic.Logger root = lc.getLogger(ch.qos.logback.classic.Logger.ROOT_LOGGER_NAME);
        var old = root.getAppender(FILE_APPENDER_NAME);
        if (old != null) {
            old.stop();
            root.detachAppender(old);
        }

        RollingFileAppender<ILoggingEvent> appender = new RollingFileAppender<>();
        appender.setName(FILE_APPENDER_NAME);
        appender.setContext(lc);
        appender.setFile(logDir.resolve("trail.log").toString());
        // 追加模式：不丢历史
        appender.setAppend(true);

        // 按天滚动（trail-2026-06-10.log）
        TimeBasedRollingPolicy<?> policy = new TimeBasedRollingPolicy<>();
        policy.setContext(lc);
        policy.setParent(appender);
        policy.setFileNamePattern(logDir.resolve("trail-%d{yyyy-MM-dd}.log").toString());
        policy.setMaxHistory(30);
        policy.start();

        appender.setRollingPolicy(policy);

        PatternLayoutEncoder encoder = new PatternLayoutEncoder();
        encoder.setContext(lc);
        encoder.setPattern("%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n");
        encoder.start();

        appender.setEncoder(encoder);
        appender.start();

        root.addAppender(appender);

        log.info("文件日志已配置：{}", logDir);
    }
}
