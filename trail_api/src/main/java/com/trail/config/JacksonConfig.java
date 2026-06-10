package com.trail.config;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * M8：与 Python FastAPI / Pydantic 兼容。
 *
 *  Pydantic v2 默认按字段名反序列化（如 {@code new_status / start_date}），
 *  前端历来发 snake_case。Java record 默认走驼峰 —— 全局切 SNAKE_CASE 后，
 *  Java record 字段可继续用驼峰（{@code newStatus}），Jackson 序列化时输出
 *  snake_case（{@code new_status}），反序列化时也认 snake_case。
 *
 *  同时注册 JavaTimeModule 让 {@code LocalDate / Instant} 走 ISO 8601 字符串，
 *  不被序列化成数组。
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> builder
                .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .modulesToInstall(new JavaTimeModule())
                .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
}
