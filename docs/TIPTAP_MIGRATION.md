# TipTap 编辑器迁移计划

## 背景

当前 `DescriptionEditor.tsx` 使用 Milkdown Crepe 作为 WYSIWYG 编辑器。在实现 @ 提及功能时遇到技术障碍：ProseMirror 的结构化文档模型使得直接插入文本非常困难，最终只能用剪贴板方案作为临时解决方案。

TipTap 同样基于 ProseMirror，但提供了官方的 `@tiptap/extension-mention` 扩展，可以完美解决 @ 提及插入问题。

## 目标

将编辑器从 Milkdown Crepe 迁移到 TipTap，实现：
1. @ 提及功能直接插入文本，无需剪贴板
2. 保持现有视觉风格完全一致
3. 保持所有调用点零改动（props 兼容）

---

## 一、技术对比

### 样式覆写方式

TipTap 和 Milkdown 都基于 ProseMirror，样式覆写方式几乎相同：

| 元素 | Milkdown 选择器 | TipTap 选择器 |
|------|-----------------|---------------|
| 编辑器容器 | `.milkdown` | `.tiptap` |
| ProseMirror 内核 | `.ProseMirror` | `.ProseMirror` |
| 段落 | `.milkdown .ProseMirror p` | `.tiptap .ProseMirror p` |

CSS 迁移只需批量替换类名前缀（`.milkdown` → `.tiptap`），CSS 变量（`--body`、`--ink` 等）全部复用。

### 功能对比

| 功能 | Milkdown Crepe | TipTap |
|------|----------------|--------|
| @ 提及 | 需自己实现，插入困难 | **官方扩展**，开箱即用 |
| Markdown 双向 | `CrepeBuilder` 内置 | `@tiptap/extension-markdown` |
| 图片上传 | `imageBlock.onUpload` | `extension-image` 配置 |
| 预览/源码切换 | 需自己实现 | `extension-markdown` 支持 |
| 维护活跃度 | 活跃 | **非常活跃（商业公司）** |

---

## 二、实施步骤

### Phase 1：安装依赖

```bash
cd trail_web
pnpm add @tiptap/react @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-mention @tiptap/extension-image \
  @tiptap/extension-link @tiptap/extension-placeholder \
  @tiptap/markdown
```

### Phase 2：重写 DescriptionEditor

**文件**：`trail_web/src/components/shared/DescriptionEditor.tsx`

核心改动：

```typescript
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'

export const DescriptionEditor = forwardRef<HTMLTextAreaElement, DescriptionEditorProps>(
  ({ value, onChange, placeholder, minHeight, textareaClassName, todos }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder }),
        Link,
        Image.configure({
          inline: true,
          allowBase64: false,
        }),
        Markdown,
        Mention.configure({
          HTMLAttributes: { class: 'mention-todo' },
          suggestion: {
            items: ({ query }) =>
              todos.filter(t =>
                !t.is_completed && !t.is_abandoned &&
                t.title.toLowerCase().includes(query.toLowerCase())
              ),
            render: () => {
              // 渲染候选浮层（参考现有 MentionPortal）
            },
            command: ({ editor, range, props }) => {
              // 直接插入 markdown 格式
              editor.chain().focus().insertContentAt(range, `@[${props.title}](todo:${props.id})`).run()
            },
          },
        }),
      ],
      content: value,
      onUpdate: ({ editor }) => {
        const md = editor.storage.markdown.getMarkdown()
        onChange(md)
      },
    })

    // ref 兼容
    useImperativeHandle(ref, () => ({
      focus: () => editor?.commands.focus(),
    }), [editor])

    return (
      <div className={`${styles.editorBox} ${textareaClassName}`} style={{ minHeight }}>
        <EditorContent editor={editor} className={styles.tiptapContainer} />
        {/* 隐藏 textarea 兼容选择器 */}
        <textarea ref={hiddenTaRef} className={styles.hiddenTaMirror} readOnly value={value} />
      </div>
    )
  }
)
```

### Phase 3：迁移 CSS

**文件**：`trail_web/src/components/shared/DescriptionEditor.module.css`

批量替换：
- `.milkdown` → `.tiptap`
- `.milkdownContainer` → `.tiptapContainer`
- 其他样式规则不变

### Phase 4：实现 Mention 候选浮层

TipTap 的 `Mention.suggestion.render` 需要返回一个渲染对象：

```typescript
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'  // 或用原生 Portal

const suggestionRender = {
  render: () => {
    let component: ReactRenderer
    let popup: Instance[]

    return {
      onStart: (props) => {
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        })
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },
      onUpdate(props) {
        component.updateProps(props)
        popup[0].setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup[0].hide()
          return true
        }
        return component.ref?.onKeyDown(props)
      },
      onExit() {
        popup[0].destroy()
        component.destroy()
      },
    }
  },
}
```

候选列表组件 `MentionList` 可复用现有 `MentionPortal` 的样式。

### Phase 5：图片上传集成

```typescript
Image.configure({
  inline: true,
  allowBase64: false,
})

// 自定义上传处理
editor.commands.setImage({
  src: await uploadImage(file),
})
```

监听粘贴事件，调用 `useUploadAttachment`。

### Phase 6：移除 Milkdown 依赖

迁移完成并测试通过后：

```bash
pnpm remove @milkdown/crepe @milkdown/kit
```

删除 `MentionPortal.tsx`（TipTap 内置处理）。

---

## 三、调用点兼容性

| 调用点 | 需改动 | 说明 |
|--------|--------|------|
| `TaskForm.tsx` | 无 | props 兼容 |
| `LogCompose.tsx` | 无 | `todos` prop 已传递 |
| `DetailPage.tsx` | 无 | props 兼容 |
| `SettingsPage.tsx` | 无 | props 兼容 |

---

## 四、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| TipTap 包体积略大 | 加载时间 | tree-shaking，按需加载扩展 |
| Mention 浮层定位 | 可能与现有 Portal 不同 | 使用 tippy.js 或自定义 Portal |
| 图片删除工具条 | TipTap 无内置 | 复用现有 `ImgToolbarPortal` |

---

## 五、验证清单

1. 编辑器启动正常，placeholder 显示
2. Markdown 编辑：粗体/斜体/链接/列表/标题
3. 图片粘贴上传，显示正确尺寸
4. 图片 hover 工具条（25/50/75/100 + 删除）
5. @ 提及触发、候选过滤、插入文本
6. 预览/源码模式切换
7. AI 润色功能
8. 所有调用点：任务表单、日志撰写、待办备注、设置页

---

## 六、后续扩展

| 触发符 | 功能 | TipTap 支持 |
|--------|------|-------------|
| `@` | 待办提及 | ✅ Mention 扩展 |
| `#` | 任务引用 | 同样用 Mention，配置不同触发符 |
| `:` | 附件/图片 | 可用自定义扩展 |

---

## 七、参考资料

- TipTap 官方文档：https://tiptap.dev/docs/editor/introduction
- Mention 扩展：https://tiptap.dev/docs/editor/extensions/mention
- Markdown 扩展：https://tiptap.dev/docs/editor/extensions/markdown
- Image 扩展：https://tiptap.dev/docs/editor/extensions/image