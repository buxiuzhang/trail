# LLM 动态 API 调用能力集成计划

## 背景

当前 LLM Tool Use 的工具是**硬编码**在 `ToolRegistry.java` 中的，每次新增/修改 API 都需要同步修改工具定义。

**用户期望**：
1. 集成 springdoc-openapi，让 LLM 实时了解项目有哪些接口
2. LLM 根据上下文语义分析来动态调用对应的接口
3. 开发者只需在新增/删除/修改等**写入操作**下让用户二次确认
4. 不再手动维护 tools，如果大模型没有调用 API 的能力，才实现对应的 tools

## 核心原则

### 1. API 文档描述规范

springdoc 从代码注解生成文档，Controller 必须写清楚描述：

```java
@Operation(summary = "添加工作日志", description = "为指定任务添加一条工作日志（日报）")
@PostMapping
public LogResponse addLog(
    @PathVariable @Parameter(description = "任务 ID") Long taskId,
    @RequestBody CreateLogRequest req
) { ... }
```

**要求**：
- 每个接口必须有清晰的 `summary` 和 `description`
- 每个参数必须有 `description`
- 从 LLM 角度出发，让 LLM 能理解接口用途

### 2. ID 与标题转换原则

**用户看到的是标题，API 需要的是 ID**。LLM 负责转换：

```
用户：添加一条cdh巡检日报
LLM：[调用 get_api_docs(search="添加日志")] 
     → 接口需要 taskId 参数
LLM：[调用 call_api(GET, /api/tasks, {search="cdh巡检"})] 
     → 返回 [{id: 10, title: "数据湖日常巡检"}, ...]
LLM：找到匹配任务「数据湖日常巡检」，请确认？
用户：确认
LLM：[调用 call_api(POST, /api/tasks/10/logs, {...})]
```

**规则**：
- 用户永远不需要输入 ID
- 大模型负责 ID ↔ 标题 的转换
- 展示给用户的信息用标题
- 调用 API 时用 ID

### 3. 组合式调用

很多接口参数需要 ID，但用户只提供语义描述。LLM 需要：
1. 先查询获取候选列表（如任务列表、待办列表）
2. 让用户选择或自动匹配
3. 获取 ID 后再调用目标接口

## 方案

### 架构变更

| 现有 | 变更后 |
|------|--------|
| `ToolRegistry` 硬编码 9 个工具 | 从 OpenAPI 文档动态生成工具定义 |
| `ToolExecutor` 手动实现每个工具 | 通用 HTTP 客户端调用本地 API |
| 写入操作无保护 | 写入操作（POST/PUT/DELETE）需要用户确认 |

### 新增组件

1. **OpenApiToolProvider** - 从 `/v3/api-docs` 读取 OpenAPI 文档，转换为 Anthropic 工具定义
2. **ApiExecutor** - 通用 HTTP 客户端，执行 LLM 选择的 API 调用
3. **ConfirmationPolicy** - 定义哪些操作需要用户确认（POST/PUT/DELETE）

### 工具设计

提供两个工具：

```json
{
  "name": "get_api_docs",
  "description": "查询 Trail 系统的 API 文档。可传入关键词搜索，或查询具体端点的参数定义。",
  "input_schema": {
    "type": "object",
    "properties": {
      "search": {"type": "string", "description": "搜索关键词，如'添加'、'日报'、'任务'"},
      "path": {"type": "string", "description": "具体 API 路径，如 /api/tasks"}
    }
  }
}
```

```json
{
  "name": "call_api",
  "description": "执行 API 调用。GET 请求直接执行，POST/PUT 需要用户确认。",
  "input_schema": {
    "type": "object",
    "properties": {
      "method": {"type": "string", "enum": ["GET", "POST", "PUT"]},
      "path": {"type": "string", "description": "API 路径"},
      "path_params": {"type": "object", "description": "路径参数"},
      "query_params": {"type": "object", "description": "查询参数"},
      "body": {"type": "object", "description": "请求体"},
      "confirmed": {"type": "boolean", "description": "用户是否已确认（POST/PUT 必填）"}
    },
    "required": ["method", "path"]
  }
}
```

### 交互流程示例

**场景 1：无匹配接口**
```
用户：帮我导出今日的日报
LLM：[调用 get_api_docs(search="导出")] 
LLM：抱歉，当前系统没有"导出日报"的功能。可用的相关功能有：查询日志、添加日志。
```

**场景 2：有歧义**
```
用户：帮我添加一条内容
LLM：[调用 get_api_docs(search="添加")]
LLM：找到多个添加相关的接口，请确认您要操作的是：
     1. 添加任务日志 (POST /api/tasks/{id}/logs)
     2. 添加待办事项 (POST /api/tasks/{id}/todos)
     3. 添加新任务 (POST /api/tasks)
用户：添加待办
LLM：[调用 get_api_docs(path="/api/tasks/{id}/todos")]
LLM：好的，添加待办需要以下信息：
     - 任务 ID（必填）
     - 待办内容（必填）
     - 补充说明（选填）
     请提供任务 ID：
用户：任务 10
LLM：请提供待办内容：
用户：完成数据同步脚本的测试
LLM：请确认：
     - 任务：数据湖日常巡检 (#10)
     - 内容：完成数据同步脚本的测试
     确认添加？
用户：确认
LLM：[调用 call_api(method=POST, path="/api/tasks/10/todos", body={...}, confirmed=true)]
LLM：已添加待办，ID: 12
```

**场景 3：单一匹配**
```
用户：查一下进行中的任务
LLM：[调用 get_api_docs(search="查询任务")]
LLM：[调用 call_api(method=GET, path="/api/tasks", query_params={status="进行中"})]
LLM：您有 5 个进行中的任务：...
```

### 用户确认机制

```java
public enum ConfirmationPolicy {
    READ_ONLY,      // GET 请求，无需确认
    NEED_CONFIRM,   // POST/PUT，需要用户确认
    FORBIDDEN       // DELETE 或 LLM 相关接口，禁止调用
}
```

**禁止 LLM 调用的接口**：
- 所有 `DELETE` 请求
- `/api/llm/*` - 润色、总结、维护建议等（避免递归调用）
- `/api/chat/*` - 聊天流式接口（避免递归调用）
- `/api/settings/llm` - LLM 配置（含 API Key，敏感）
- `/api/attachments` - 附件上传（涉及文件，无法通过 JSON 传递）
- `/api/settings/data-dir` - 数据目录切换（影响太大）

在 `call_api` 执行前检查：
- `GET` 请求直接执行（除非是禁止的路径）
- `POST/PUT` 请求：LLM 先展示操作内容，用户确认后执行
- `DELETE` 请求或禁止路径：返回错误 "此操作禁止执行"

## 实现步骤

### Phase 1: 集成 springdoc-openapi

1. **pom.xml** 添加依赖：
   ```xml
   <dependency>
       <groupId>org.springdoc</groupId>
       <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
       <version>2.5.0</version>
   </dependency>
   ```

2. **完善 Controller 注解**
   - 为每个 `@RequestMapping` 添加 `@Operation(summary, description)`
   - 为每个 `@PathVariable`、`@RequestParam`、`@RequestBody` 添加 `@Parameter(description)`
   - 描述要清晰，让 LLM 能理解接口用途

3. 验证访问 `/v3/api-docs` 获取完整 API Schema

### Phase 2: 实现动态工具生成

1. **OpenApiService.java**
   - 启动时加载 `/v3/api-docs` OpenAPI 文档到内存
   - 提供搜索方法 `searchApiDocs(String keyword)` - 按关键词搜索相关接口
   - 提供查询方法 `getApiDetail(String path)` - 获取具体接口的参数定义
   - 过滤掉禁止的接口（DELETE、LLM 相关等）

2. **修改 ChatWithToolsService.java**
   - 工具列表固定为：`get_api_docs`、`call_api`
   - System Prompt 中说明两个工具的使用方式

### Phase 3: 实现工具执行器

1. **ApiToolExecutor.java**（替代原 ToolExecutor）
   - `execute_get_api_docs(input)` - 搜索/查询 API 文档
   - `execute_call_api(input)` - 执行实际 API 调用
   - 检查 `confirmed` 参数，POST/PUT 未确认时返回 `need_confirm: true`

2. **ApiFilter.java**
   - 定义禁止接口列表
   - 检查请求是否被允许

### Phase 4: 更新 System Prompt

在 `Prompts.java` 中更新：

```
你可以通过两个工具与 Trail 系统交互：

1. get_api_docs(search?, path?) - 查询 API 文档
   - 传入 search 关键词搜索相关接口
   - 传入 path 获取具体接口的参数定义

2. call_api(method, path, ...) - 执行 API 调用
   - GET 请求直接执行
   - POST/PUT 需要 confirmed=true 才能执行

**重要原则**：
- 用户看到的是「标题」，API 需要的是「ID」
- 你负责 ID ↔ 标题 的转换
- 用户永远不需要输入 ID
- 展示给用户的信息用标题，调用 API 时用 ID

**组合调用示例**：
用户说"添加一条cdh巡检日报"：
1. 调用 get_api_docs(search="添加日志") 了解接口需要 taskId
2. 调用 call_api(GET, /api/tasks, {search="cdh巡检"}) 查找任务
3. 向用户展示「数据湖日常巡检」，确认后获取 ID=10
4. 调用 call_api(POST, /api/tasks/10/logs, {...})

**其他原则**：
- 无匹配接口时，如实告知用户"没有这个功能"
- 多个匹配时，列出候选让用户选择（用标题展示）
- 禁止编造接口或参数
```

### Phase 5: 清理旧代码

1. 删除或标记废弃：`ToolRegistry.java`、`ToolExecutor.java`
2. 保留：`Tool.java`（工具定义结构仍需要）

## 关键文件

| 文件 | 操作 |
|------|------|
| `pom.xml` | 添加 springdoc-openapi 依赖 |
| **Controller 类** | 完善 `@Operation`、`@Parameter` 注解描述 |
| `OpenApiService.java` | 新增 - 加载/搜索 API 文档 |
| `ApiFilter.java` | 新增 - 过滤禁止接口 |
| `ApiToolExecutor.java` | 新增 - 执行 get_api_docs 和 call_api |
| `ToolRegistry.java` | 简化为只注册 2 个工具 |
| `ChatWithToolsService.java` | 修改工具执行逻辑 |
| `Prompts.java` | 更新 TOOLS_DESC，强调 ID↔标题转换原则 |
| `ToolExecutor.java` | 废弃，逻辑迁移到 ApiToolExecutor |

## 验证

1. 启动后访问 `/v3/api-docs` 验证 OpenAPI 文档生成，确认描述清晰
2. 用户说"查一下进行中的任务" → LLM 调用 `get_api_docs(search="查询任务")` → 调用 `call_api(GET, /api/tasks, {status=进行中})`
3. 用户说"添加一条cdh巡检日报" → LLM 组合调用：查任务 → 展示标题 → 确认 → 用 ID 调用添加日志
4. 用户说"帮我添加一条内容" → LLM 返回多个候选（用标题展示）→ 用户选择
5. 用户说"帮我导出今日的日报" → 无匹配 → 如实反馈"没有这个功能"
6. 用户说"删除任务 10" → `call_api(DELETE)` 被拦截 → 返回"此操作禁止执行"

## 风险与对策

| 风险 | 对策 |
|------|------|
| LLM 选择错误的 API | 在 System Prompt 中明确每个 API 的用途 |
| 写入操作误确认 | 展示完整操作内容，包含影响范围 |
| 敏感数据泄露 | 过滤掉敏感字段（如 api_key） |
| API 参数复杂 | OpenAPI Schema 包含完整的参数定义 |
| 附件上传无法处理 | 禁止 `/api/attachments`，LLM 提示用户在前端操作 |
| API 返回错误 | 将 4xx/5xx 错误信息返回给 LLM，让 LLM 决定如何处理 |

## 用户确认交互

在对话中确认，不需要弹窗：
1. LLM 调用 `call_api(method=POST, ...)`
2. 系统检测到需要确认，返回 `need_confirm: true` + 操作摘要
3. LLM 向用户展示操作内容，询问确认
4. 用户回复"确认"
5. LLM 再次调用 `call_api`，带上 `confirmed: true` 参数
6. 系统执行实际操作
