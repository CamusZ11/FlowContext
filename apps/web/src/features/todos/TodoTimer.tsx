import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError } from "@flowcontext/data";
import type { TodoTimeEntry } from "@flowcontext/domain";
import { randomUuid } from "../../platform/randomUuid";
import { ClockIcon } from "../../ui/icons";
import "./todo-timer.css";

export function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  return (hours ? [hours, minutes, seconds] : [minutes, seconds])
    .map((value) => String(value).padStart(2, "0")).join(":");
}

export function TodoTimerButton({ title, onClick }: { title: string; onClick(): void }) {
  return (
    <button type="button" className="todo-timer-button" aria-label={`计时 ${title}`} title="计时" onClick={onClick}>
      <ClockIcon width={16} height={16} />
    </button>
  );
}

export interface TodoTimerTask {
  id: string;
  title: string;
  revision: number;
}

export type TodoTimerRequest = { task: TodoTimerTask } | { close: true; revision: number };

interface TimerRun {
  task: TodoTimerTask;
  entry: TodoTimeEntry;
  resumedAt: number | null;
  frozen: boolean;
}

function newRun(task: TodoTimerTask): TimerRun {
  const id = randomUuid();
  if (!id) throw new Error("无法为计时生成编号");
  return {
    task,
    entry: { id, startedAt: new Date().toISOString(), elapsedMs: 0 },
    resumedAt: performance.now(),
    frozen: false,
  };
}

function elapsedAt(run: TimerRun, now: number) {
  return run.entry.elapsedMs + (run.resumedAt === null ? 0 : Math.max(0, now - run.resumedAt));
}

export function TodoTimer({ initialTask, request, archive, onClose }: {
  initialTask: TodoTimerTask;
  request?: TodoTimerRequest;
  archive(todoId: string, entry: TodoTimeEntry): Promise<void>;
  onClose(revision: number): Promise<boolean>;
}) {
  const [run, setRun] = useState(() => newRun(initialTask));
  const [now, setNow] = useState(() => performance.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRun = useRef(run);
  const inFlight = useRef(false);
  const archived = useRef(false);
  const taskDeleted = useRef(false);
  const pending = useRef<TodoTimerRequest | undefined>(undefined);
  const lastHandled = useRef<TodoTimerRequest | undefined>(undefined);

  const updateRun = useCallback((next: TimerRun) => {
    currentRun.current = next;
    setRun(next);
  }, []);

  const finish = useCallback(async (intent: TodoTimerRequest) => {
    pending.current = intent;
    if (inFlight.current) return;
    const active = currentRun.current;
    if ("task" in intent && intent.task.id === active.task.id && !active.frozen) {
      updateRun({ ...active, task: intent.task });
      return;
    }

    inFlight.current = true;
    const entry = { ...active.entry, elapsedMs: Math.round(elapsedAt(active, performance.now())) };
    updateRun({ ...active, entry, resumedAt: null, frozen: true });
    setSaving(true);
    setError(null);
    try {
      if (!archived.current && !taskDeleted.current) {
        await archive(active.task.id, entry);
        archived.current = true;
      }
      let next = pending.current ?? intent;
      while ("close" in next) {
        if (await onClose(next.revision)) return;
        const latest = pending.current;
        if (!latest || ("close" in latest && latest.revision === next.revision)) return;
        next = latest;
      }
      updateRun(newRun(next.task));
      setNow(performance.now());
      archived.current = false;
      taskDeleted.current = false;
    } catch (failure) {
      if (failure instanceof HttpError && failure.code === "todo_not_found") {
        taskDeleted.current = true;
        setError("任务已删除");
      } else {
        setError(archived.current ? "关闭失败" : "保存失败");
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [archive, onClose, updateRun]);

  useEffect(() => {
    if (request && request !== lastHandled.current) {
      lastHandled.current = request;
      void finish(request);
    }
  }, [finish, request]);

  useEffect(() => {
    if (run.resumedAt === null) return;
    const interval = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(interval);
  }, [run.resumedAt]);

  function toggle() {
    if (inFlight.current || currentRun.current.frozen) return;
    const active = currentRun.current;
    const timestamp = performance.now();
    setNow(timestamp);
    updateRun({
      ...active,
      entry: { ...active.entry, elapsedMs: elapsedAt(active, timestamp) },
      resumedAt: active.resumedAt === null ? timestamp : null,
    });
  }

  const toggleLabel = run.resumedAt === null ? "继续" : "暂停";
  const retry = error !== null && !taskDeleted.current;
  const closeLabel = retry ? (archived.current ? "重试关闭" : "重试保存") : "关闭计时";
  return (
    <main className="todo-timer" aria-label="任务计时" data-paused={run.resumedAt === null}>
      <span className="todo-timer-indicator" aria-hidden="true" />
      <div className="todo-timer-readout">
        <span className="todo-timer-title" title={run.task.title}>{run.task.title}</span>
        <div className="todo-timer-time">
          <span role="timer" aria-label="已用时间">{formatElapsed(elapsedAt(run, now))}</span>
          {saving && <span role="status">保存中</span>}
          {error && <span role="alert">{error}</span>}
        </div>
      </div>
      <button type="button" aria-label={toggleLabel} title={toggleLabel} disabled={run.frozen} onClick={toggle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={run.resumedAt === null ? "m9 5 10 7-10 7z" : "M9 6v12m6-12v12"} />
        </svg>
      </button>
      <button type="button" aria-label={closeLabel} title={closeLabel} disabled={saving} onClick={() => {
        const latest = pending.current;
        const revision = latest ? ("task" in latest ? latest.task.revision : latest.revision) : run.task.revision;
        void finish(retry && latest ? latest : { close: true, revision });
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={retry ? "M19 8a7 7 0 1 0 .2 7M19 3v5h-5" : "m7 7 10 10M17 7 7 17"} />
        </svg>
      </button>
    </main>
  );
}
