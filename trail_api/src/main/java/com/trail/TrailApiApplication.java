package com.trail;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.stereotype.Component;

import java.awt.Desktop;
import java.net.URI;

@SpringBootApplication
@ConfigurationPropertiesScan
public class TrailApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(TrailApiApplication.class, args);
    }

    @Component
    static class BrowserLauncher {
        @EventListener(ApplicationReadyEvent.class)
        public void launchBrowser() {
            String url = "http://localhost:8765";
            try {
                if (Desktop.isDesktopSupported()) {
                    Desktop.getDesktop().browse(URI.create(url));
                } else {
                    // Linux/Mac 无 Desktop 支持时的备选
                    String os = System.getProperty("os.name").toLowerCase();
                    if (os.contains("linux")) {
                        Runtime.getRuntime().exec("xdg-open " + url);
                    } else if (os.contains("mac")) {
                        Runtime.getRuntime().exec("open " + url);
                    }
                }
            } catch (Exception e) {
                // 启动失败不阻塞应用，用户可手动访问
                System.out.println("无法自动打开浏览器，请手动访问: " + url);
            }
        }
    }
}
