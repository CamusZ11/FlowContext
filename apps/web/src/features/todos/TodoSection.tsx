import type { TodoCreate, TodoPatch } from "@flowcontext/domain";
import { usePlatform } from "../../app/PlatformContext";
import { CompletedTodos } from "./CompletedTodos";
import { TodoForm } from "./TodoForm";
import { TodoRow } from "./TodoRow";
import { useTodoMutations, useTodos } from "./useTodos";
import { SunIcon } from "../../ui/icons";
import "./todo.css";

export interface TodoSectionProps {
  date: string;
}

export function TodoSection({ date }: TodoSectionProps) {
  const platform = usePlatform();
  const query = useTodos(date);
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
          {platform.mode === "web" ? <p className="eyebrow">{date}</p> : null}
          <div className="section-title-with-icon"><SunIcon width="23" height="23" /><h2 id="todo-heading">今日待办</h2></div>
        </div>
        <span className="section-count">{todos.length}</span>
      </div>
      <TodoForm date={date} mode={platform.mode} onCreate={create} />
      {query.isPending ? <p role="status">加载中…</p> : null}
      {query.isError ? <p role="alert" className="error-text">加载失败，请重试</p> : null}
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
      {!query.isPending && todos.length === 0 ? <p className="empty-state">今天还没有安排。</p> : null}
    </section>
  );
}
