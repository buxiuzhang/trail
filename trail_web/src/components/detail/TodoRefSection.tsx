import { useState, useRef, useEffect, useCallback } from 'react'
import type { TodoOut } from '@/types'
import styles from './TodoRefSection.module.css'

interface TodoRefSectionProps {
  taskId: number
  todos: TodoOut[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
}

export function TodoRefSection({ taskId, todos, selectedIds, onChange }: TodoRefSectionProps) {
  const [inputValue, setInputValue] = useState('')
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 可选的待办：未完成、未废弃、未被选中
  const availableTodos = todos.filter(t =>
    !t.is_completed && !t.is_abandoned && !selectedIds.includes(t.id)
  )

  // 根据输入过滤待办列表
  const filteredTodos = availableTodos.filter(t =>
    t.title.toLowerCase().includes(inputValue.replace('@', '').toLowerCase())
  )

  // 点击外部关闭下拉
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setShowAutocomplete(false)
    }
  }, [])

  useEffect(() => {
    if (showAutocomplete) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAutocomplete, handleClickOutside])

  // 输入变化：检测 @ 触发下拉
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setInputValue(value)
    // 只有输入包含 @ 时才触发下拉
    if (value.includes('@')) {
      setShowAutocomplete(true)
    } else {
      setShowAutocomplete(false)
    }
  }

  // 选择待办
  function handleSelect(todo: TodoOut) {
    onChange([...selectedIds, todo.id])
    setInputValue('')
    setShowAutocomplete(false)
    inputRef.current?.focus()
  }

  // 移除已选待办
  function handleRemove(id: number) {
    onChange(selectedIds.filter(i => i !== id))
  }

  // 获取已选待办的详情
  function getSelectedTodo(id: number): TodoOut | undefined {
    return todos.find(t => t.id === id)
  }

  return (
    <div className={styles.section} ref={containerRef}>
      {/* 已选待办列表 */}
      {selectedIds.length > 0 && (
        <div className={styles.selectedList}>
          {selectedIds.map(id => {
            const todo = getSelectedTodo(id)
            if (!todo) return null
            return (
              <div key={id} className={styles.selectedItem}>
                <span className={styles.selectedTitle}>{todo.title}</span>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => handleRemove(id)}
                  title="移除关联"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 输入行 */}
      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={inputValue}
          onChange={handleInputChange}
          placeholder={availableTodos.length > 0 ? '输入 @ 选择待办...' : '无可用待办'}
          disabled={availableTodos.length === 0}
        />
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            // 点击 + 按钮时，自动输入 @ 触发下拉
            setInputValue('@')
            setShowAutocomplete(true)
            inputRef.current?.focus()
          }}
          title="添加关联待办"
          disabled={availableTodos.length === 0}
        >
          +
        </button>

        {/* 自动完成下拉 */}
        {showAutocomplete && filteredTodos.length > 0 && (
          <div className={styles.autocomplete}>
            {filteredTodos.map(todo => (
              <div
                key={todo.id}
                className={styles.autocompleteItem}
                onClick={() => handleSelect(todo)}
              >
                <span className={styles.itemTitle}>{todo.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}