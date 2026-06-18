# @ 待办提及与任务引用实现计划

## Context

实现任务引用和待办提及功能，采用 **ID 存储 + 动态渲染** 方案。

**用户需求**：
- 任务引用：渲染为可点击超链接 `[@任务标题](#/task:id)`
- 待办提及：渲染为带下划线的文本 `<u>@待办标题</u>`
- 所有引用显示在统一的"关联待办/任务"区域（TodoRefSection 组件）

## 设计方案

### 存储格式（后端）

**文本内容**：
- 任务引用：`@task_123`（直接存储 ID）
- 待办提及：`@todo_456`

**关联字段**：
- `work_logs.todo_ids: number[]` - 已存在
- `work_logs.task_ids: number[]` - 新增字段

### 渲染逻辑（前端）

**动态渲染流程**：
1. 解析文本中的 `@task_xxx` 和 `@todo_xxx` 格式
2. 根据 ID 从任务/待办列表中查找标题
3. 渲染为：
   - `@task_xxx` → `<a href="#/task/xxx">@任务标题</a>`（可点击跳转）
   - `@todo_xxx` → `<u>@待办标题</u>`（带下划线）

**优势**：
- 标题变更不影响引用（只存 ID）
- 渲染时显示最新标题
- 支持状态显示（已完成/废弃的待办有特殊样式）

### 触发机制

**候选浮层**：输入 `@` 时自动弹出，候选按优先级排序：
1. **当前任务的待办**（未完成、未删除、未作废）—— 最优先
2. **全局任务**—— 其次

**筛选功能**：
- 输入 `@告警` 时，候选列表只显示标题包含"告警"的待办/任务
- 筛选逻辑：`item.title.toLowerCase().includes(query.toLowerCase())`

**键盘交互**：
- `↑` / `↓` 箭头：在候选列表中移动选中项
- `Enter`：确认选中项，插入对应引用
- `Esc`：关闭候选浮层

**候选分组显示**：
- 待办组：显示为 `@todo图标 + 标题`
- 任务组：显示为 `@task图标 + 标题`

**视觉区分**：
- 待办候选：标签标识（如 "待办"）
- 任务候选：标签标识（如 "任务"）

## 关键文件

### 需要修改（前端）
- `src/components/shared/DescriptionEditor.tsx` - 编辑器，修改 Mention 扩展候选逻辑
- `src/components/shared/richtext-utils.ts` - 新增解析 `@task_xxx` 和 `@todo_xxx` 格式
- `src/components/shared/RichText.tsx` - 渲染组件，动态获取标题渲染链接/下划线
- `src/components/shared/RichText.module.css` - 待办下划线样式
- `src/components/detail/TodoRefSection.tsx` - 扩展为显示待办和任务引用
- `src/components/detail/LogCompose.tsx` - 提取 ID 并保存，传递 tasks prop
- `src/types/log.ts` - 新增 `task_ids` 字段

### 需要修改（后端）
- `trail_api/src/main/resources/db/ddl.sql` - 新增 `task_ids` TEXT 字段
- `trail_api/src/main/java/com/trail/web/dto/LogCreateRequest.java` - 新增 `task_ids` 字段
- `trail_api/src/main/java/com/trail/web/dto/LogResponse.java` - 新增 `task_ids` 字段
- `trail_api/src/main/java/com/trail/store/WorkLogStore.java` - 存储/读取 task_ids

## Implementation Plan

### Phase 1: 后端新增 task_ids 字段

#### Step 1.1: DDL 更新
```sql
ALTER TABLE work_logs ADD COLUMN task_ids TEXT DEFAULT '[]';
```

#### Step 1.2: DTO 更新
- LogCreateRequest 新增 `List<Long> taskIds`
- LogResponse 新增 `List<Long> taskIds`

#### Step 1.3: Store 更新
- WorkLogStore 存储/读取 task_ids JSON

### Phase 2: 前端编辑器候选逻辑

#### Step 2.1: 修改 Mention 扩展
合并待办和任务候选，按优先级排序：

```typescript
suggestion: {
  items: ({ query }) => {
    // 1. 当前任务的待办（优先）
    const currentTodos = todos.filter(t => 
      !t.is_completed && !t.is_abandoned && !t.is_deleted &&
      t.title.toLowerCase().includes(query.toLowerCase())
    ).map(t => ({ type: 'todo', id: t.id, label: t.title }))
    
    // 2. 全局任务（其次）
    const allTasks = tasks.filter(t =>
      t.title.toLowerCase().includes(query.toLowerCase())
    ).map(t => ({ type: 'task', id: t.id, label: t.title }))
    
    return [...currentTodos, ...allTasks]
  },
  command: ({ editor, range, props }) => {
    const { type, id } = props
    editor.chain().focus().insertContentAt(range, `@${type}_${id}`).run()
  },
}
```

#### Step 2.2: 候选浮层渲染
修改 MentionPortal 显示分组：
- 待办项显示 `@todo图标 + 标题`
- 任务项显示 `@task图标 + 标题`

### Phase 3: 解析和渲染

#### Step 3.1: 解析函数
在 `richtext-utils.ts` 新增：

```typescript
// 提取文本中的引用 ID
export function extractRefs(text: string): { todoIds: number[], taskIds: number[] }

// 解析文本为渲染片段
export function parseRichText(text: string): Array<
  | { kind: 'text'; value: string }
  | { kind: 'todoMention'; id: number }
  | { kind: 'taskMention'; id: number }
  | { kind: 'img'; ... }
>
```

正则表达式：`/@(todo|task)_(\d+)/g`

#### Step 3.2: 渲染组件
在 `RichText.tsx` 中：
- `todoMention` → `<u>@{getTodoTitle(id)}</u>`（从 todos 数据中查找标题）
- `taskMention` → `<a href="#/task/{id}">@{getTaskTitle(id)}</a>`（从 tasks 数据中查找标题）

需要新增 props：`getTodoTitle(id)` 和 `getTaskTitle(id)` 回调函数。

### Phase 4: TodoRefSection 扩展

修改 `TodoRefSection.tsx` 显示待办和任务引用：
- 显示已关联的待办列表（从 todo_ids 和文本中的 @todo_xxx 提取）
- 显示已关联的任务列表（从 task_ids 和文本中的 @task_xxx 提取）
- 每个关联项旁边有删除按钮

### 删除机制

**两种删除方式**：

**方式1：文本编辑器整体删除**
- 引用 `@todo_xxx` 或 `@task_xxx` 作为 TipTap 的 Mention 节点渲染
- 用户按一次 Backspace/Delete 即删除整个引用节点（不可分割）
- TipTap Mention 扩展天生支持此行为，防止残缺引用

**方式2：关联区域删除**
- TodoRefSection 中每个关联项有删除按钮
- 点击删除后：
  1. 从 `todo_ids` 或 `task_ids` 数组中移除该 ID
  2. 同时在文本中查找并替换对应的引用为空字符串（使用正则 `/@(todo|task)_ID/g`）
- 适合精确删除特定引用

```typescript
// 删除关联项的逻辑
function handleRemoveRef(type: 'todo' | 'task', id: number) {
  // 1. 从数组中移除
  setTodoIds(prev => prev.filter(i => i !== id))
  setTaskIds(prev => prev.filter(i => i !== id))
  // 2. 从文本中删除引用
  const newContent = content.replace(new RegExp(`@${type}_${id}`, 'g'), '')
  setContent(newContent)
}
```

### Phase 5: 保存逻辑

在 `LogCompose.tsx` 中：
```typescript
// 提取文本中的 ID
const { todoIds, taskIds } = extractRefs(content)
// 与手动选择的合并去重
const allTodoIds = [...new Set([...todoIds, ...selectedTodoIds])]
const allTaskIds = [...new Set([...taskIds, ...selectedTaskIds])]
// 保存
await onSave({ ..., todo_ids: allTodoIds, task_ids: allTaskIds })
```

## Verification

### 测试步骤
1. 编辑器输入 `@`，候选浮层显示当前待办 + 全局任务
2. 选择待办，文本插入 `@todo_123`
3. 选择任务，文本插入 `@task_456`
4. 保存日志，检查 todo_ids 和 task_ids 存储正确
5. 加载日志，检查渲染：
   - `@todo_123` → `<u>@待办标题</u>`
   - `@task_456` → `<a href="#/task/456">@任务标题</a>`
6. 点击任务链接跳转到对应任务详情页

### 边界测试
- 待办/任务被删除：显示 `@已删除` 或灰色样式
- 标题变更：渲染显示最新标题（因为只存 ID）