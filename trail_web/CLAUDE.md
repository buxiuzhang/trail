# CLAUDE.md · trail_web

本文件供 Claude Code 读取。**所有对话、注释、文档用中文。**

## 身份

trail 项目的前端（与同仓库后端 `../trail_app/` 配合）。React 19 + Vite 8 + TS 6。业务目标、后端契约、关键不变量见**根 `../CLAUDE.md`**——本文件不重复。

## 启动 / 常用命令

```bash
pnpm install            # 装依赖
pnpm dev                # http://localhost:5173，/api 走 proxy → 后端 127.0.0.1:8765
pnpm build              # tsc -b && vite build，产物 dist/
pnpm preview            # 预览 dist/
pnpm lint               # eslint .
pnpm exec tsc --noEmit  # TypeScript 类型检查（不生成文件）
```

后端必须先跑（`../trail_api` 目录 `java -jar target/trail-api.jar`）——`pnpm dev` 才有数据。

## 后端契约

- 全部走同源 `/api/*`，由 Vite `server.proxy` 转发到 `http://127.0.0.1:8765`（`vite.config.ts`）。生产构建后由后端挂载静态资源。
- 后端在 `503` 时**可能**是未配置数据目录或 SQLite 写锁冲突——`src/api/client.ts:request()` 最多自动重试 3 次（指数退避 200/400/600ms）。**别在前端再包一层重试**。
- SSE：`streamPost()` 解析 `data: {…}\n\n`，`[DONE]` 结束。后端 `POST /api/llm/chat/stream` 唯一流端点。
- 4xx 错误体形如 `{ "detail": "…" }`，`request()` 把它转成 `Error.message` 抛出；UI 拿到的就是 `err.message`。

## 路由（HashRouter）

```
/                  → IndexPage
/task/:id          → DetailPage
/edit/:id          → FormPage（编辑）
/new               → FormPage（新建）
/settings          → SettingsPage
*                  → NotFoundPage
```

URL 里只有 id，没有 title / alias。`title` 之类的展示数据全部从 `useTasks` query 来。

## 顶层 Provider 嵌套（`App.tsx`）

```
HashRouter
  └─ FilterProvider        // 侧栏筛选状态
     └─ ModalProvider      // 状态变更 / 作废确认弹窗
        └─ ToastProvider   // 保存成功 / 失败提示
           └─ <页面 />
           └─ ChatProvider // 悬浮气泡 + 窗口
```

新增全局能力时按"是否需要穿透所有页面"决定挂哪一层。Toast/Modal 已经有专用 hook（`useToastContext` / `useModalContext`），别自己再写 instance。

## 数据请求

- React Query v5。`useQuery` 写 `['settings', 'llm']` 这种 `queryKey` 习惯——`['资源', '子键']`。
- 写操作走 `useMutation` + `onSuccess: invalidateQueries({ queryKey: ['资源'] })`。
- `staleTime: 60_000` 是项目默认（设置类接口）。
- **不直引 `api` 调**——每个领域在 `src/api/<资源>.ts` 暴露一个 `useXxx` / `useSaveXxx` hook（见 `tasks.ts` / `settings.ts` / `logs.ts` / `chat.ts` / `llm.ts` / `insights.ts`）。

## 主题 / CSS 约定

- 编辑 / 档案美学。CSS 变量集中在 `src/App.css`：墨色 `--ink/--ink-soft/--ink-faded/--ink-ghost`、纸色 `--paper`、印章红 `--red`、墨绿 `--green-ink`、等宽 `--mono`。
- 组件样式**优先 CSS Module**（`Foo.tsx` + `Foo.module.css`），仅全局工具类（`field` / `btn` / `empty` / `month-block` 等）写在 `App.css`。
- 字体：`var(--body)` / `var(--heading)` / `var(--mono)`——别再写裸 `font-family`。
- 颜色用 `var(--ink-…)`，别用十六进制。

## 不要做

- 不直接 fetch——`api.get/post/put/del` 或 `streamPost` 走 `client.ts`。
- 不写自己的 `Error` 处理——`client.ts` 已经把 `detail` 转成 `Error.message`。
- 不绕过 HashRouter 写 `<a href="/…">`——用 `<a href="#/…">` 或 `Link to="/…"`，保持 hash 路由。
- 不引新 UI 库。Button / Select / Toast / Crumbs 都在 `src/components/shared/`，先看有没有现成的。
- 不在 `src/api/client.ts` 之外的组件里写 SSE 解析——统一用 `streamPost`。

## TipTap 编辑器

`DescriptionEditor` 是基于 TipTap 的 Markdown WYSIWYG 编辑器，核心扩展：

- **StarterKit**：基础格式（加粗/斜体/标题/列表/引用等），`trailingNode: false`（避免列表结尾崩溃）
- **@tiptap/markdown**：Markdown 解析/序列化
- **HighlightedCodeBlock**：代码块语法高亮（扩展自 CodeBlockLowlight，注册 `parseMarkdown`/`renderMarkdown`）
- **Mention**：`@` 触发待办/任务引用候选，已引用项自动过滤
- **mentionDecoration**：装饰器扩展，将 `@todo:ID`/`@task:ID` 显示为对应标题

@mention 候选弹窗：
- ↑/↓ 键导航，Enter 确认
- 选中项自动滚动到可视区域
- 已出现在文档中的引用不再出现在候选中
