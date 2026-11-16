import { FormEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { TodoCreate } from "@flowcontext/domain";
import { PlusIcon } from "../../ui/icons";

export interface TodoFormProps {
  date: string;
  slot?: { date: string; time: string };
  disabled?: boolean;
  onCreate(input: TodoCreate): Promise<void>;
}

export function TodoForm({ date, slot, disabled = false, onCreate }: TodoFormProps) {
  const titleId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!slot) return;
    titleInput.current?.focus();
  }, [slot]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        title: normalizedTitle,
        plannedDate: date,
        plannedTime: slot?.time ?? null,
        isCompleted: false,
        projectId: null,
        topicCardId: null,
      });
      setTitle("");
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="todo-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={titleId}>添加事项</label>
      <input
        id={titleId}
        ref={titleInput}
        className="todo-title-input"
        placeholder="添加事项…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        disabled={saving || disabled}
      />
      <button type="submit" className="todo-add-button" aria-label={saving ? "保存中…" : "添加"} disabled={saving || disabled}>
        {saving ? "保存中…" : <PlusIcon className="todo-add-icon" width="24" height="24" />}
      </button>
      {error ? <p role="alert" className="error-text">{error}</p> : null}
    </form>
  );
}
