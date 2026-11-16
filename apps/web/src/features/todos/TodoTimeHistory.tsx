import { useId, useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FlowRepository } from "@flowcontext/data";
import type { Todo } from "@flowcontext/domain";
import { formatElapsed } from "./TodoTimer";

export function TodoTimeHistory({ todo, load, onClose }: {
  todo: Todo;
  load: NonNullable<FlowRepository["listTodoTimeEntries"]>;
  onClose(): void;
}) {
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const query = useQuery({
    queryKey: ["todo-time-entries", todo.id],
    queryFn: ({ signal }) => load(todo.id, signal),
    refetchOnMount: "always",
  });
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  const entries = query.data ?? [];
  const total = entries.reduce((elapsed, entry) => elapsed + entry.elapsedMs, 0);
  return (
    <dialog className="todo-time-history" ref={dialog} aria-labelledby={headingId} onClose={onClose}>
      <header>
        <h2 id={headingId}>计时记录</h2>
        <button type="button" onClick={() => dialog.current?.close()}>关闭</button>
      </header>
      <p className="todo-time-history-title">{todo.title}</p>
      {query.isPending ? <p role="status">加载中…</p> : null}
      {query.isError ? <p role="alert">加载计时记录失败 <button type="button" onClick={() => { void query.refetch(); }}>重试</button></p> : null}
      {query.data && (
        <>
          <p className="todo-time-history-total"><span>累计耗时</span><strong>{formatElapsed(total)}</strong></p>
          {entries.length ? <ol role="list" aria-label="每次计时">
            {entries.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.startedAt}>{new Date(entry.startedAt).toLocaleString("zh-CN", { hour12: false })}</time>
                <span>{formatElapsed(entry.elapsedMs)}</span>
              </li>
            ))}
          </ol> : <p className="muted">还没有计时记录</p>}
        </>
      )}
    </dialog>
  );
}
