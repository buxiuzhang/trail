package com.trail.config;

import com.trail.store.ReportTemplateStore;
import com.trail.store.exception.DataDirNotConfiguredException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 启动时检查 report_templates 表是否为空，若为空则写入一条默认周报模板。
 */
@Component
public class ReportTemplateInitializer {

    private static final Logger log = LoggerFactory.getLogger(ReportTemplateInitializer.class);

    private final ReportTemplateStore store;
    private final DataDirService dataDirService;

    public ReportTemplateInitializer(ReportTemplateStore store, DataDirService dataDirService) {
        this.store = store;
        this.dataDirService = dataDirService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seedDefaults() {
        if (!dataDirService.isConfigured()) return;
        try {
            if (!store.findAll().isEmpty()) return;

            String weeklyTemplate = """
                # 本周工作周报

                **时间范围：** {time_range}

                ## 一、本周工作概况

                [按任务简述本周完成的主要工作，突出进展与成果]

                ## 二、各任务详情

                | 任务 | 本周工作 | 工时（h） |
                |------|---------|----------|
                [按任务逐行填写]

                ## 三、遇到的问题与解决

                [说明本周遇到的障碍及处理方式，无则填"无"]

                ## 四、下周计划

                - [ ] [下周重点工作 1]
                - [ ] [下周重点工作 2]

                ## 五、备注

                [其他需要说明的事项]
                """;

            store.save("本周工作周报", "默认周报模板，按任务汇总本周进展", weeklyTemplate.strip(), 0);
            log.info("已写入默认周报模板");
        } catch (DataDirNotConfiguredException ignored) {
        } catch (Exception e) {
            log.warn("写入默认报表模板失败: {}", e.getMessage());
        }
    }
}
