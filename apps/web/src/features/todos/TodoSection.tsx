import { useLayoutEffect, useRef, useState } from "react";
import type { Todo, TodoCreate, TodoPatch } from "@flowcontext/domain";
import { usePlatform } from "../../app/PlatformContext";
import { useFlowRepository } from "../../app/RepositoryContext";
import { CompletedTodos } from "./CompletedTodos";
import { TodoForm } from "./TodoForm";
import { TodoRow } from "./TodoRow";
import { useTodoMutations, useTodos } from "./useTodos";
import { DateSelector } from "../calendar/DateSelector";
import { TodoCalendar } from "./TodoCalendar";
import { TodoTimeHistory } from "./TodoTimeHistory";
import "./todo.css";

type TodoView = "list" | "calendar";
const todoViewStorageKey = "flowcontext.todo-view";

function readTodoView(): TodoView {
  try {
    return window.localStorage.getItem(todoViewStorageKey) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}

export interface TodoSectionProps {
  date: string;
  rolloverIdentity?: string;
  onDateChange(value: string): void;
  expandedWeek?: boolean;
}

export function TodoSection({ date, rolloverIdentity, onDateChange, expandedWeek = false }: TodoSectionProps) {
  const platform = usePlatform();
  const repository = useFlowRepository();
  const { startTodoTimer } = platform;
  const [view, setView] = useState(readTodoView);
  const [slot, setSlot] = useState<{ date: string; time: string }>();
  const [weekDate, setWeekDate] = useState<string>();
  const [openingWeek, setOpeningWeek] = useState(false);
  const [weekError, setWeekError] = useState(false);
  const [timerError, setTimerError] = useState(false);
  const [historyTask, setHistoryTask] = useState<Todo>();
  const listTimeEntries = repository.listTodoTimeEntries;
  const openHistory = listTimeEntries ? setHistoryTask : undefined;
  const query = useTodos(date, rolloverIdentity);
  const mutations = useTodoMutations(date);
  const todos = query.data ?? [];
  const activeTodos = todos.filter((todo) => !todo.isCompleted);
  const completedTodos = todos.filter((todo) => todo.isCompleted);
  const mutationBusy = mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending || mutations.updateFromCalendar.isPending;
  const startTimer = startTodoTimer && (({ id, title }: Todo) => {
    setTimerError(false);
    void startTodoTimer({ id, title }).catch(() => setTimerError(true));
  });

  function changeView(nextView: TodoView) {
    setView(nextView);
    if (nextView === "list") setSlot(undefined);
    try {
      window.localStorage.setItem(todoViewStorageKey, nextView);
    } catch {
      // The view can still be changed when local storage is unavailable.
    }
  }

  async function openWeek() {
    if (!platform.openTodoWeek) {
      setWeekDate(date);
      return;
    }
    setWeekError(false);
    setOpeningWeek(true);
    try {
      await platform.openTodoWeek(date);
    } catch {
      setWeekError(true);
    } finally {
      setOpeningWeek(false);
    }
  }

  function changeDate(nextDate: string) {
    setSlot(undefined);
    onDateChange(nextDate);
  }

  function selectSlot(nextDate: string, time: string) {
    onDateChange(nextDate);
    setSlot({ date: nextDate, time });
  }

  async function updateFromCalendar(todo: Todo, patch: TodoPatch) {
    await mutations.updateFromCalendar.mutateAsync({ todo, patch });
  }

  async function create(input: TodoCreate) {
    await mutations.create.mutateAsync(input);
    setSlot((current) => current === slot ? undefined : current);
  }
  async function update(id: string, patch: TodoPatch) {
    await mutations.update.mutateAsync({ id, patch });
  }
  async function remove(id: string) {
    await mutations.remove.mutateAsync(id);
  }

  return (
    <section aria-labelledby={expandedWeek ? undefined : "todo-heading"} aria-label={expandedWeek ? "每周任务" : undefined} className="content-section todo-section">
      <div className="section-heading-row">
        <div>
          <h2 id={expandedWeek ? undefined : "todo-heading"}><DateSelector mode={platform.mode} value={date} onChange={changeDate} /></h2>
        </div>
        {!expandedWeek && <div className="todo-view-controls">
          <div className="todo-view-switch" role="group" aria-label="任务视图">
            <button type="button" aria-pressed={view === "list"} onClick={() => changeView("list")}>列表</button>
            <button type="button" aria-pressed={view === "calendar"} onClick={() => changeView("calendar")}>日历</button>
          </div>
          {view === "list" && <span className="section-count">{todos.length}</span>}
        </div>}
      </div>
      <TodoForm date={date} slot={slot?.date === date ? slot : undefined} disabled={mutations.updateFromCalendar.isPending} onCreate={create} />
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
      {weekError && <p role="alert" className="error-text">周视图打开失败，请重试</p>}
      {timerError && <p role="alert" className="error-text">计时窗口打开失败，请重试</p>}
      {expandedWeek || view === "calendar" ? (
        <TodoCalendar
          date={date} today={platform.today()} todos={todos} busy={mutationBusy}
          expandedWeek={expandedWeek} openingWeek={openingWeek} onOpenWeek={expandedWeek ? undefined : openWeek}
          onStartTimer={startTimer}
          onOpenTimeHistory={openHistory}
          onDateChange={changeDate} onSelectSlot={selectSlot} onUpdate={updateFromCalendar}
        />
      ) : (
        <>
          <ul className="todo-list" aria-label="未完成 To-do">
            {activeTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onUpdate={(patch) => update(todo.id, patch)}
                onDelete={() => remove(todo.id)}
                onStartTimer={startTimer}
                onOpenTimeHistory={openHistory}
                disabled={mutationBusy}
              />
            ))}
          </ul>
          <CompletedTodos todos={completedTodos} onUpdate={update} onDelete={remove} onStartTimer={startTimer}
            onOpenTimeHistory={openHistory} disabled={mutationBusy} />
          {!query.isPending && todos.length === 0 ? <p className="empty-state">这一天还没有安排</p> : null}
        </>
      )}
      {weekDate && <WeekDialog date={weekDate} rolloverIdentity={rolloverIdentity} onDateChange={setWeekDate} onClose={() => setWeekDate(undefined)} />}
      {historyTask && listTimeEntries && <TodoTimeHistory todo={historyTask}
        load={(id, signal) => listTimeEntries.call(repository, id, signal)} onClose={() => setHistoryTask(undefined)} />}
    </section>
  );
}

function WeekDialog({ onClose, ...props }: Omit<TodoSectionProps, "expandedWeek"> & { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="todo-week-dialog" aria-label="周视图" onClose={onClose}>
      <div className="todo-week-dialog-actions">
        <button type="button" aria-label="关闭周视图" onClick={() => dialog.current?.close()}>关闭</button>
      </div>
      <TodoSection {...props} expandedWeek />
    </dialog>
  );
}
