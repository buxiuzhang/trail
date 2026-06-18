# 预览/源码模式统一组件方案

## 问题分析

### 两条渲染路径不一致

当前项目中有**两套 markdown 渲染路径**，视觉效果不同：

| 场景       | 组件链路                                           | 渲染引擎                | 效果                   |
| ---------- | -------------------------------------------------- | ----------------------- | ---------------------- |
| 编辑器预览 | `DescriptionEditorWithMode → DescriptionEditor` | TipTap（始终完整渲染）  | 正确渲染所有 markdown  |
| 列表/卡片  | `CollapsibleText → RichText → hasMarkdown?`    | 条件性 MarkdownRenderer | 部分 markdown 语法丢失 |

### `hasMarkdown` 检测不全面

`RichText.tsx:63` 的 `hasMarkdown` 函数存在漏报：

```
能检测：**粗体**、__粗体__、*斜体*、_斜体_、# 标题、- 列表、1. 列表、`代码`
漏报：  [链接](url)、> 引用、--- 分割线、~~删除线~~、表格
```

当文本只包含漏报语法时，`hasMarkdown` 返回 false，RichText 走 `parseRichText`（仅图片+纯文本），markdown 格式丢失。

### ContentViewer 内部路径分裂

`ContentViewer` 在预览模式下有两种路径：

- **有 maxHeight**：`CollapsibleText → RichText → 条件性 MarkdownRenderer`
- **无 maxHeight**：直接 `MarkdownRenderer`

同一文本在不同场景渲染结果不同。

### 模式管理分散

| 组件                          | 预览模式         | 源码模式  | 是否可编辑 |
| ----------------------------- | ---------------- | --------- | ---------- |
| `DescriptionEditorWithMode` | TipTab WYSIWYG   | textarea  | 可编辑     |
| `ContentViewer`             | MarkdownRenderer | `<pre>` | 只读       |

两者各自管理自己的模式切换，文案不统一（"预览编辑" vs "预览查看"）。

---

## 目标

1. **统一渲染引擎**：所有预览模式（编辑/只读）使用同一套渲染，效果一致
2. **清晰的两层抽象**：
   - 编辑场景：可编辑的预览/源码切换
   - 只读场景：只读的预览/源码切换
3. **组件可复用**：任何需要展示 markdown 的地方都可以直接使用

---

## 方案

### 架构

```
统一渲染核心：MarkdownRenderer（TipTap 只读，效果与编辑器预览一致）

编辑场景                               只读场景
  DescriptionEditorWithMode              ContentViewer
  ├── mode='preview'                     └── 始终预览（MarkdownRenderer）
  │   └── DescriptionEditor                   └── TipTap（只读）
  │       └── TipTap（可编辑）
  └── mode='source'
      └── textarea（可编辑）
```

**核心原则**：
- 只读预览不再经过 `RichText` 的条件分支，始终使用 `MarkdownRenderer`
- **只读场景不提供预览/源码切换**——`ContentViewer` 不传 `onModeChange` 时纯渲染预览
- 编辑场景的预览/源码切换保留在 `DescriptionEditorWithMode` 中

### 边界：折叠功能

折叠是布局控制，不是渲染差异。`ContentViewer` 自己处理折叠：

```
ContentViewer（自带折叠能力）
├── 折叠检测（scrollHeight > maxHeight）
├── 预览模式 → MarkdownRenderer + 折叠
├── 源码模式 → <pre> + 折叠
└── 展开/收起按钮
```

不再嵌套 `CollapsibleText`。

### 边界：@提及和图片

- `@todo:ID` / `@task:ID`：`MarkdownRenderer` 已通过 `createMentionDecorationExtension` 支持
- 图片 `![](...)`：`MarkdownRenderer` 已加载 `Image` 扩展
- 图片交互（尺寸/删除）：只读场景不需要，这是编辑场景专属

因此只读预览不需要 `RichText`，直接用 `MarkdownRenderer` 即可。

---

## 实现步骤

### Step 1：重写 ContentViewer

**文件**：`trail_web/src/components/shared/ContentViewer.tsx`

- 预览模式始终使用 `MarkdownRenderer`（不经过 `RichText`）
- 自带折叠功能（`maxHeight` prop），不再依赖 `CollapsibleText`
- **不传 `onModeChange` 时纯只读**：始终渲染 MarkdownRenderer 预览，不显示切换按钮
- **传入 `mode` + `onModeChange` 时**：显示 `ModeToggleButton(usage="view")`，支持预览/源码切换（用于需要源码查看的少数场景）

**伪代码**：

```tsx
export function ContentViewer({ text, mode, onModeChange, maxHeight, ... }) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsTruncate, setNeedsTruncate] = useState(false)

  // 折叠检测
  useEffect(() => {
    if (!contentRef.current || expanded) return
    const el = contentRef.current
    const check = () => setNeedsTruncate(el.scrollHeight > maxHeight + 20)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded, maxHeight])

  return (
    <div className={styles.wrapper}>
      <ModeToggleButton usage="view" ... />
      {mode === 'preview' ? (
        <div ref={contentRef} style={{ maxHeight: expanded ? 'none' : maxHeight }}>
          <MarkdownRenderer text={text} ... />
          {!expanded && needsTruncate && <展开按钮 />}
        </div>
      ) : (
        <pre>{text}</pre>
      )}
      {expanded && needsTruncate && <收起按钮 />}
    </div>
  )
}
```

### Step 2：简化 CollapsibleText

**文件**：`trail_web/src/components/shared/CollapsibleText.tsx`

- 内部 `RichText` 替换为 `MarkdownRenderer`（始终完整渲染）
- 或：内部直接使用 `ContentViewer`（但需要 mode 状态，会引入不必要的切换按钮）
- 推荐：让 `CollapsibleText` 内部改用 `MarkdownRenderer`

这样所有经过 `CollapsibleText` 的地方（DetailHeader、TaskCard）都获得一致的 markdown 渲染。

### Step 3：简化 RichText

**文件**：`trail_web/src/components/shared/RichText.tsx`

- `RichText` 不再承担 markdown 渲染职责
- 简化为纯文本 + 图片 + @提及的轻量渲染器
- markdown 渲染统一由 `MarkdownRenderer` / `ContentViewer` 负责
- 可选：将 `RichText` 重命名为 `InlineRenderer` 或 `SimpleText`

### Step 4：替换调用方

**文件**：多个

| 文件                         | 当前使用            | 改为                                      |
| ---------------------------- | ------------------- | ----------------------------------------- |
| `DetailHeader.tsx`         | `CollapsibleText` | `ContentViewer`（已改）                 |
| `LogEntry.tsx`             | `CollapsibleText` | `ContentViewer`（已改）                 |
| `TodoSection.tsx`          | `RichText`        | `ContentViewer`（已改，但无折叠）       |
| `TaskCard.tsx`             | `CollapsibleText` | `ContentViewer`（已改）                 |
| `SummaryBox.tsx`（如果有） | `RichText`        | `ContentViewer` 或 `MarkdownRenderer` |

### Step 5：验证渲染一致性

- 确认编辑器预览（编辑模式下）和 `ContentViewer` 预览使用同一套 TipTap 配置
- 样式统一：`MarkdownRenderer.module.css` 和 `DescriptionEditor.module.css` 中的排版变量（字号、行高、间距）保持一致

---

## 关键文件清单

| 文件                                               | 操作           | 说明                                          |
| -------------------------------------------------- | -------------- | --------------------------------------------- |
| `src/components/shared/ContentViewer.tsx`        | **重写** | 自带折叠，预览始终用 MarkdownRenderer         |
| `src/components/shared/ContentViewer.module.css` | 修改           | 适配新的折叠实现                              |
| `src/components/shared/CollapsibleText.tsx`      | 修改           | 内部改用 MarkdownRenderer                     |
| `src/components/shared/RichText.tsx`             | 简化           | 不再承担 markdown 渲染，只做纯文本+图片+@提及 |
| `src/components/shared/MarkdownRenderer.tsx`     | 保留           | 核心渲染引擎，不需大改                        |
| `src/components/shared/ModeToggleButton.tsx`     | 保留           | 已支持 usage 参数                             |
| 各消费组件                                         | 已改完         | 检查是否都使用 ContentViewer                  |

---

## 验证

1. `pnpm dev` 启动前端
2. 逐项验证：
   - 编年日志列表：markdown 渲染与编辑器预览一致（标题、列表、粗体、斜体、链接、引用、代码）
   - 任务卡片描述：折叠/展开正常，markdown 渲染正确
   - 待办事项描述：展开后 markdown 渲染正确
   - 编辑日志：预览模式切换正常，不影响编辑能力
3. 测试边界：无内容、纯文本、纯 markdown、混合内容、含图片、含 @提及
