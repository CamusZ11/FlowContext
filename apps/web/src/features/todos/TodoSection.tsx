import type { TodoCreate, TodoPatch } from "@flowcontext/domain";
import { usePlatform } from "../../app/PlatformContext";
import { CompletedTodos } from "./CompletedTodos";
import { TodoForm } from "./TodoForm";
import { TodoRow } from "./TodoRow";
import { useTodoMutations, useTodos } from "./useTodos";
import { DateSelector } from "../calendar/DateSelector";
import "./todo.css";

export interface TodoSectionProps {
  date: string;
  rolloverIdentity?: string;
  onDateChange(value: string): void;
}

export function TodoSection({ date, rolloverIdentity, onDateChange }: TodoSectionProps) {
  const platform = usePlatform();
  const query = useTodos(date, rolloverIdentity);
  const mutations = useTodoMutations(date);
  const todos = query.data ?? [];
  const activeTodos = todos.filter((todo) => !todo.isCompleted);
  const completedTodos = todos.filter((todo) => todo.isCompleted);
  const mutationBusy = mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending;

  async function create(input: TodoCreate) {
    await mutations.create.mutateAsync(input);
  }
  async function update(id: string, patch: TodoPatch) {
    await mutations.update.mutateAsync({ id, patch });
  }
  async function remove(id: string) {
    await mutations.remove.mutateAsync(id);
  }

  return (
    <section aria-labelledby="todo-heading" className="content-section todo-section">
      <div className="section-heading-row">
        <div>
          <h2 id="todo-heading"><DateSelector mode={platform.mode} value={date} onChange={onDateChange} /></h2>
        </div>
        <span className="section-count">{todos.length}</span>
      </div>
      <TodoForm date={date} onCreate={create} />
      {query.isPending ? <p role="status">加载中…</p> : null}
      {query.isError ? (
        <div role="alert" className="error-text">
          <span>加载失败，请重试</span>
          {query.retryRollover ? (
            <button
              type="button"
              onClick={() => { void query.retryRollover?.(); }}
              disabled={query.isRolloverRetrying}
            >
              {query.isRolloverRetrying ? "正在重试…" : "重试加载今日待办"}
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="todo-list" aria-label="未完成 To-do">
        {activeTodos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onUpdate={(patch) => update(todo.id, patch)}
            onDelete={() => remove(todo.id)}
            disabled={mutationBusy}
          />
        ))}
      </ul>
      <CompletedTodos todos={completedTodos} onUpdate={update} onDelete={remove} disabled={mutationBusy} />
      {!query.isPending && todos.length === 0 ? <p className="empty-state">这一天还没有安排</p> : null}
    </section>
  );
}
