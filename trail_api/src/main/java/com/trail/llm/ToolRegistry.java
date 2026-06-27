package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 工具注册表
 * 定义 LLM 可用的工具，目前只有两个：get_api_docs 和 call_api
 */
@Component
public class ToolRegistry {

    private final ObjectMapper mapper;
    private final McpClientManager mcpClientManager;
    private final List<Tool> builtinTools;

    public ToolRegistry(ObjectMapper mapper, McpClientManager mcpClientManager) {
        this.mapper = mapper;
        this.mcpClientManager = mcpClientManager;
        this.builtinTools = List.of(
            listControllers(),
            listEndpoints(),
            getApiDocs(),
            getLogsByDate(),
            callApi(),
            exportDailyReport(),
            exportWeeklyReport(),
            vectorSearch(),
            getSkillDetail()
        );
    }

    public List<Tool> getTools() {
        List<Tool> all = new ArrayList<>(builtinTools);
        all.addAll(mcpClientManager.getAllTools());
        return all;
    }

    public List<ObjectNode> getToolsJson() {
        return getTools().stream().map(t -> t.toJson(mapper)).toList();
    }

    // ============================================================
    // 工具定义
    // ============================================================

    /**
     * 列出所有 Controller（模块）
     * 第一层：帮助 LLM 定位到正确的模块
     */
    private Tool listControllers() {
        ObjectNode props = mapper.createObjectNode();
        return new Tool(
            "list_controllers",
            "列出 Trail 系统的所有功能模块（Controller）。用于了解系统有哪些功能，如'任务管理'、'工作日志'、'待办事项'等。",
            new Tool.InputSchema("object", props, null)
        );
    }

    /**
     * 列出指定 Controller 的所有接口
     * 第二层：缩小搜索范围
     */
    private Tool listEndpoints() {
        ObjectNode props = mapper.createObjectNode();
        props.set("controller", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "Controller 名称，如'工作日志'、'任务管理'"));

        return new Tool(
            "list_endpoints",
            "列出指定功能模块（Controller）下的所有接口。用于查看某个模块有哪些操作，如'工作日志'模块包括添加、查询、编辑、删除日志等接口。",
            new Tool.InputSchema("object", props, List.of("controller"))
        );
    }

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
            "查询具体接口的参数详情。传入 path 参数获取接口的完整参数定义，包括 path 参数、query 参数、request body 等。",
            new Tool.InputSchema("object", props, null)
        );
    }

    /**
     * 按日期查询工作日志（直接数据库查询，无需 API 发现）
     */
    private Tool getLogsByDate() {
        ObjectNode props = mapper.createObjectNode();
        props.set("date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "查询单天，格式 YYYY-MM-DD，或传 \"today\"/\"yesterday\"。与 start_date/end_date 互斥。"));
        props.set("start_date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "区间起始日期，格式 YYYY-MM-DD。"));
        props.set("end_date", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "区间结束日期，格式 YYYY-MM-DD，默认今天。"));

        return new Tool(
            "get_logs_by_date",
            "按日期查询工作日志，返回按日期和任务分组的日志明细及工时统计。适合「今天工作情况」「本周日志」「某天做了什么」等查询。不传参数默认查今天。",
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

    /**
     * 向量语义搜索（跨任务/日报/待办）
     */
    private Tool vectorSearch() {
        ObjectNode props = mapper.createObjectNode();
        props.set("query", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "搜索关键词或描述，支持语义搜索，如'登录问题'、'数据库优化'"));
        props.set("top_k", mapper.createObjectNode()
            .put("type", "integer")
            .put("description", "返回结果数量，默认 5，最大 20"));
        props.set("source", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "限定来源类型：task（任务）、log（日报）、todo（待办），不传则搜索全部"));

        return new Tool(
            "vector_search",
            "语义搜索任务、日报、待办内容。当需要查找相关历史工作、某类任务或某主题日报时使用。比 call_api 更快，适合模糊检索。",
            new Tool.InputSchema("object", props, List.of("query"))
        );
    }

    /**
     * 按需获取 Skill 完整提示词（渐进式披露）
     */
    private Tool getSkillDetail() {
        ObjectNode props = mapper.createObjectNode();
        props.set("name", mapper.createObjectNode()
            .put("type", "string")
            .put("description", "Skill 名称，与系统提示词目录中列出的名称完全一致"));

        return new Tool(
            "get_skill_detail",
            "获取指定 Skill 的完整系统提示词内容。当系统提示词目录中列出了某个扩展能力，而你需要了解其详细指令时调用。",
            new Tool.InputSchema("object", props, List.of("name"))
        );
    }
}