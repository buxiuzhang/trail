package com.trail.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * 向量索引专用线程池：单线程串行写入，避免并发争抢 SQLite 写锁。
     * 队列上限 500，满时丢弃最旧任务（不阻塞业务线程）。
     */
    @Bean("vectorIndexExecutor")
    public Executor vectorIndexExecutor() {
        return new ThreadPoolExecutor(
            1, 1,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(500),
            r -> {
                Thread t = new Thread(r, "vector-index");
                t.setDaemon(true);
                return t;
            },
            new ThreadPoolExecutor.DiscardOldestPolicy()
        );
    }

    /**
     * 全量初始化专用线程池：单线程，不排队（队列容量0）。
     * startAsync 内部用 AtomicReference 控制互斥，不依赖此队列。
     */
    @Bean("vectorInitExecutor")
    public Executor vectorInitExecutor() {
        return new ThreadPoolExecutor(
            1, 1,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(1),
            r -> {
                Thread t = new Thread(r, "vector-init");
                t.setDaemon(true);
                return t;
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
    }
}
