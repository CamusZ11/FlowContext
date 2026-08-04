import { useState } from "react";
import type { Todo, TodoPatch } from "@flowcontext/domain";
import { PencilIcon, TrashIcon } from "../../ui/icons";

export interface TodoRowProps {
  todo: Todo;
  onUpdate(patch: TodoPatch): Promise<void>;
  onDelete(): Promise<void>;
  disabled?: boolean;
}

export function TodoRow({ todo, onUpdate, onDelete, disabled = false }: TodoRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function update(patch: TodoPatch) {
    setBusy(true);
    setError(null);
    try {
      await onUpdate(patch);
      setEditing(false);
    } catch {
      setError("保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch {
      setError("删除失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`todo-row${todo.isCompleted ? " completed" : ""}`}
      data-testid="todo-row"
      data-todo-id={todo.id}
    >
      <div className="todo-row-main">
        <input
          type="checkbox"
          aria-label={`完成 ${todo.title}`}
          checked={todo.isCompleted}
          disabled={disabled || busy}
          onChange={(event) => void update({ isCompleted: event.target.checked })}
        />
        {editing ? (
          <input
            aria-label={`编辑 ${todo.title}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void update({ title: title.trim() });
              if (event.key === "Escape") { setTitle(todo.title); setEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <span className={`todo-title${todo.isCompleted ? " completed" : ""}`} title={todo.title}>{todo.title}</span>
        )}
        {todo.plannedTime ? <time dateTime={todo.plannedTime}>{todo.plannedTime}</time> : null}
      </div>
      <div className="todo-row-actions">
        <button type="button" data-icon-button="true" aria-label={`编辑 ${todo.title}`} onClick={() => setEditing(true)} disabled={disabled || busy}>
          <PencilIcon width="18" height="18" />
        </button>
        <button type="button" data-icon-button="true" aria-label={`删除 ${todo.title}`} onClick={() => void remove()} disabled={disabled || busy}>
          <TrashIcon width="18" height="18" />
        </button>
      </div>
      {error ? <p role="alert" className="error-text">{error}</p> : null}
    </li>
  );
}
