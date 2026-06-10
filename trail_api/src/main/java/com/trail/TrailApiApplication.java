package com.trail;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class TrailApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(TrailApiApplication.class, args);
    }
}
