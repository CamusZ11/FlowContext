import { FormEvent, useState } from "react";
import type { TodoCreate } from "@flowcontext/domain";

export interface TodoFormProps {
  date: string;
  mode: "web" | "desktop";
  onCreate(input: TodoCreate): Promise<void>;
}

export function TodoForm({ date, mode, onCreate }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [plannedDate, setPlannedDate] = useState(date);
  const [plannedTime, setPlannedTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !plannedDate) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        title: normalizedTitle,
        plannedDate: mode === "desktop" ? date : plannedDate,
        plannedTime: plannedTime || null,
        isCompleted: false,
        projectId: null,
        topicCardId: null,
      });
      setTitle("");
      setPlannedTime("");
      if (mode === "web") setPlannedDate(date);
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="todo-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="todo-title">添加事项</label>
      <input
        id="todo-title"
        placeholder="添加事项…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      {mode === "web" ? (
        <label>
          <span className="sr-only">计划日期</span>
          <input
            type="date"
            aria-label="计划日期"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
            required
          />
        </label>
      ) : null}
      <label>
        <span className="sr-only">计划时刻</span>
        <input
          type="time"
          aria-label="计划时刻（可选）"
          value={plannedTime}
          onChange={(event) => setPlannedTime(event.target.value)}
        />
      </label>
      <button type="submit" disabled={saving}>{saving ? "保存中…" : "添加"}</button>
      {error ? <p role="alert" className="error-text">{error}</p> : null}
    </form>
  );
}
