# 聊天 · Tool Use 协议

> 详细方案见 `/Users/trent/.claude/plans/trail-web-bright-porcupine.md`（plan agent 草稿）。
> 本文件是**协议级规范**，给代码维护者看；plan 文档是给实施者看。

## 1. Context

历史版本聊天把"系统设定"硬塞 system prompt：20 条活跃任务 × 3 条最近日志 × 80 字 ≈ 1500-2000 input tokens，每次对话都付。改成 Anthropic 协议原生 tool use 后，LLM 按需调工具，**简单寒暄不再付钱**。

## 2. 工具集（5 个）

所有工具只读 / 建议性查询，**不写库**。入口做 Pydantic 校验，非法入参 → `is_error=true` tool_result 回填。

| 工具 | 输入 | 输出 | 备注 |
| --- | --- | --- | --- |
| `list_tasks` | `{status?, nature?, search?}` | `[{...task dict}]` | 上限 20 条 |
| `list_recent_logs` | `{task_id, since_days?, limit?, phase?}` | `[{log_date, content, ...}]` | `limit` 默认 5 最大 20；`content` 截断 800 字 |
| `get_task_detail` | `{task_id}` | `{...task dict}` | 含 description / summary / maintenance_summary / tags |
| `count_tasks_by_status` | `{}` | `{by_status, by_nature, total}` | 复用 `InsightStore.overview()` |
| `ask_maintenance_suggestion` | `{task_id, logs?}` | `{suggestion: "..."}` | 内部调一次 LLM `ask_maintenance`；**不写库** |

实现位置：`trail_app/llm_service.py` 的 `TOOLS` 常量 + `_execute_tool()` 调度。

## 3. 多轮循环

- **cap = 3 轮**：避免 LLM 调死循环
- **错误隔离**：单工具异常 → `is_error=true` 的 tool_result 回填，LLM 看到自己决定
- **简化审计**：ai_records 的 `prompt_text` 只写"用户最终问题 + `<multi-round tool use>` 标识"，不重复写完整 messages

## 4. SSE 协议

事件类型（前后端共享）：

| 事件 | 格式 | 用途 |
| --- | --- | --- |
| 文本片段 | `data: {"delta":"..."}\n\n` | 模型文本（推前端打字机） |
| 工具调用 | `data: {"tool_call":{"name":"...","input":{...}}}\n\n` | 可选：前端显示"正在查询…" |
| 工具返回 | `data: {"tool_result":{"name":"...","ok":true}}\n\n` | 可选：前端隐藏"正在查询…" |
| 流结束 | `data: {"done":true}\n\n` + `data: [DONE]\n\n` | 关闭标记 |
| 错误 | `data: {"error":"..."}\n\n` | mid-stream / 预检失败 |

**降级兼容**：旧前端只消费 `{delta, done, [DONE], error}` 四事件也能跑，只是少了"正在查询…"反馈。

## 5. Token 节省估算

| 场景 | 改前（"系统设定"） | 改后（tool use） | 节省 |
| --- | --- | --- | --- |
| "你好" | ~1500 tokens | ~50 tokens | ~97% |
| "今天有什么工作" | ~1500 tokens | 工具 1 次 ~300 tokens | ~80% |
| "任务 #3 详情" | ~1500 tokens | 工具 1 次 ~200 tokens | ~87% |

## 6. 安全边界

- 5 个工具全部**只读**；`ask_maintenance_suggestion` 也只返建议文本
- Pydantic 入参校验：`task_id` 必须 int；非法 id 抛 `ValueError` → `is_error=true`
- API key 不入 prompt / 不入 tool_result / 不入 ai_records
- LLM 永不直写库（CLAUDE.md 硬规则）

## 7. 配置

- `LLMConfig.chat_system_prompt` 模板里**必须**含 `{tools_desc}` 占位符（描述 5 工具）
- 用户在设置页编辑的 prompt 漏写 `{tools_desc}` 时，后端 `_render_chat_system()` 自动在末尾兜底追加
- 默认模板：`trail_app.prompts.DEFAULT_CHAT_SYSTEM`

## 8. 风险

1. **MiniMax 代理对 tool use 支持未验证**：若 `base_url` 含 `minimax` 且返 `unsupported content block type: tool_use`，临时方案为系统提示追加 fallback 提示；终极方案为 base_url 路由开关，保留旧 `chat_stream` 路径。
2. **流式 input JSON 累积**：多 tool_use 块并行时按 `event.index` 区分；`get_final_message()` 阶段从 `final.content` 兜底取 `block.input`（不走累积 buffer）。
3. **前端代码现状**：plan agent 报告 `trail_web/` 目录读不到，但 git log 显示有前端流式 commit。实施前需 `git log --all -- trail_web/` 找回；SSE 新增事件**完全可选**，不影响旧前端。

## 9. 验证（end-to-end）

1. `pytest tests/test_web_api.py -k chat -v` 4 个新用例全过；旧用例不受影响
2. 重启后端
3. curl 三种场景：
   - "今天有什么工作" → 日志应见 `tool_call: list_tasks`
   - "你好" → 0 tool_call
   - "任务 #3 详情" → 调 `get_task_detail`
4. 删 ANTHROPIC_API_KEY → 预检 503
5. DBeaver 看 `ai_records`：新行 `op='chat_tool_use'`
