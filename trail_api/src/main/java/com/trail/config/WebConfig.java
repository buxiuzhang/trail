package com.trail.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * SPA fallback：挂载前端 dist/，非 /api/* 路径先查文件，不存在回退 index.html。
 *
 * M8：前端 dist 路径由环境变量 TRAIL_FRONTEND_DIR 决定（不再走 AppProperties）。
 * 默认查找顺序：env TRAIL_FRONTEND_DIR > ../trail_web/dist（相对项目根）
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path dist = resolveDist();
        if (dist == null || !Files.exists(dist)) return;
        Path assets = dist.resolve("assets");
        if (Files.exists(assets)) {
            registry.addResourceHandler("/assets/**")
                    .addResourceLocations("file:" + assets + "/");
        }
        // 静态文件走 /**；找不到时落到 index.html（SPA fallback）。
        // 但 /api/* 是业务接口，找不到文件就返 null → 触发 404 链
        // （而不是把 index.html 喂回去）。
        registry.addResourceHandler("/**")
                .addResourceLocations("file:" + dist + "/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        // 业务 API 路径和 OpenAPI 文档路径不参与 SPA fallback
                        if (resourcePath != null && (
                                resourcePath.startsWith("api/") ||
                                resourcePath.startsWith("v3/") ||
                                resourcePath.equals("swagger-ui.html") ||
                                resourcePath.startsWith("swagger-ui/")
                        )) {
                            return null;
                        }
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) return requested;
                        return location.createRelative("index.html");
                    }
                });
    }

    /**
     * 解析前端 dist 目录。
     * 优先级：env TRAIL_FRONTEND_DIR > static/ (发布包模式) > ../trail_web/dist (开发模式)
     */
    private Path resolveDist() {
        // 1. 环境变量优先
        String env = System.getenv("TRAIL_FRONTEND_DIR");
        if (env != null && !env.isBlank()) {
            Path p = Paths.get(env);
            Path resolved = p.isAbsolute() ? p : p.toAbsolutePath();
            System.out.println("[WebConfig] TRAIL_FRONTEND_DIR: " + resolved);
            return resolved;
        }

        // 2. 发布包模式：JAR 同级的 static/ 目录
        try {
            // 获取当前工作目录，检查是否有 static/ 子目录
            Path workDir = Paths.get("").toAbsolutePath();
            Path staticDir = workDir.resolve("static");
            System.out.println("[WebConfig] Work dir: " + workDir);
            System.out.println("[WebConfig] Checking static dir: " + staticDir + " exists=" + Files.exists(staticDir));
            if (Files.exists(staticDir) && Files.isDirectory(staticDir)) {
                return staticDir;
            }

            // 尝试从 JAR 所在目录查找
            Path jarDir = getJarDirectory();
            if (jarDir != null) {
                Path jarStaticDir = jarDir.resolve("static");
                System.out.println("[WebConfig] JAR dir: " + jarDir);
                System.out.println("[WebConfig] Checking JAR static dir: " + jarStaticDir + " exists=" + Files.exists(jarStaticDir));
                if (Files.exists(jarStaticDir) && Files.isDirectory(jarStaticDir)) {
                    return jarStaticDir;
                }
            }
        } catch (Exception e) {
            System.out.println("[WebConfig] Error resolving static path: " + e.getMessage());
        }

        // 3. 开发模式：相对项目根的 trail_web/dist
        Path devDist = Paths.get("../trail_web/dist");
        Path resolved = devDist.isAbsolute() ? devDist : devDist.toAbsolutePath();
        System.out.println("[WebConfig] Dev mode dist: " + resolved);
        return resolved;
    }

    /**
     * 获取 JAR 文件所在目录
     */
    private Path getJarDirectory() {
        try {
            // 方法1：通过 ProtectionDomain
            var codeSource = getClass().getProtectionDomain().getCodeSource();
            if (codeSource != null) {
                Path path = Paths.get(codeSource.getLocation().toURI());
                if (path.toString().endsWith(".jar")) {
                    return path.getParent();
                }
                if (Files.isDirectory(path)) {
                    // 开发模式下是 classes 目录
                    return null;
                }
            }
        } catch (Exception e) {
            // 忽略，尝试其他方法
        }
        return null;
    }
}
