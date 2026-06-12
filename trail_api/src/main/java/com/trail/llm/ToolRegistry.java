package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 工具注册表
 * 定义 LLM 可用的工具，目前只有两个：get_api_docs 和 call_api
 */
@Component
public class ToolRegistry {

    private final ObjectMapper mapper;
    private final List<Tool> tools;

    public ToolRegistry(ObjectMapper mapper) {
        this.mapper = mapper;
        this.tools = List.of(
            getApiDocs(),
            callApi(),
            exportDailyReport(),
            exportWeeklyReport()
        );
    }

    public List<Tool> getTools() {
        return tools;
    }

    public List<ObjectNode> getToolsJson() {
        return tools.stream().map(t -> t.toJson(mapper)).toList();
    }

    // ============================================================
    // 工具定义
    // ============================================================

    /**
     * 查询 API 文档
     */
    private Tool getApiDocs() {
        ObjectNode props = mapper.createObjectNode();
        props.set("search", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "搜索关键词，如'添加'、'查询'、'任务'、'日志'"));
        props.set("path", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "具体 API 路径，如 /api/tasks/{taskId}/logs"));

        return new Tool(
            "get_api_docs",
            "查询 Trail 系统的 API 文档。可传入关键词搜索相关接口，或查询具体端点的参数定义。",
            new Tool.InputSchema("object", props, null)
        );
    }

    /**
     * 执行 API 调用
     */
    private Tool callApi() {
        ObjectNode props = mapper.createObjectNode();
        props.set("method", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "HTTP 方法：GET、POST、PUT")
            .set("enum", mapper.valueToTree(List.of("GET", "POST", "PUT"))));
        props.set("path", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "API 路径，如 /api/tasks"));
        props.set("query_params", mapper.createObjectNode()
            .put("type", "object")
            .put("description", "查询参数，如 {\"status\": \"进行中\"}"));
        props.set("body", mapper.createObjectNode()
            .put("type", "object")
            .put("description", "请求体（POST/PUT 时使用）"));
        props.set("confirmed", mapper.createObjectNode()
            .put("type", "boolean")
            .put("description", "用户是否已确认（POST/PUT 操作必填）"));

        return new Tool(
            "call_api",
            "执行 API 调用。GET 请求直接执行，POST/PUT 需要用户确认后才能执行。",
            new Tool.InputSchema("object", props, List.of("method", "path"))
        );
    }

    /**
     * 导出今日日报
     */
    private Tool exportDailyReport() {
        ObjectNode props = mapper.createObjectNode();
        props.set("date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "日期，格式 YYYY-MM-DD，默认今天"));

        return new Tool(
            "export_daily_report",
            "导出今日工作日报，返回下载链接。",
            new Tool.InputSchema("object", props, null)
        );
    }

    /**
     * 导出本周周报
     */
    private Tool exportWeeklyReport() {
        ObjectNode props = mapper.createObjectNode();
        props.set("start_date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "起始日期，格式 YYYY-MM-DD，默认本周一"));
        props.set("end_date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "结束日期，格式 YYYY-MM-DD，默认今天"));

        return new Tool(
            "export_weekly_report",
            "导出本周工作周报，返回下载链接。",
            new Tool.InputSchema("object", props, null)
        );
    }
}