import { useEffect, useState } from "react";
import { ClockIcon } from "../../ui/icons";
import "./todo-timer.css";

function formatElapsed(milliseconds: number) {
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

export function TodoTimer({ title, onClose }: { title: string; onClose(): Promise<void> }) {
  const [startedAt, setStartedAt] = useState<number | null>(() => performance.now());
  const [accumulated, setAccumulated] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const [closeFailed, setCloseFailed] = useState(false);
  const running = startedAt !== null;
  const elapsed = accumulated + (running ? now - startedAt : 0);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(interval);
  }, [running]);

  function toggle() {
    const timestamp = performance.now();
    if (startedAt === null) {
      setNow(timestamp);
      setStartedAt(timestamp);
    } else {
      setAccumulated(accumulated + timestamp - startedAt);
      setStartedAt(null);
    }
  }

  const toggleLabel = running ? "暂停" : "继续";
  return (
    <main className="todo-timer" aria-label="任务计时" data-paused={!running}>
      <span className="todo-timer-indicator" aria-hidden="true" />
      <div className="todo-timer-readout">
        <span className="todo-timer-title" title={title}>{title}</span>
        <span role="timer" aria-label="已用时间">{formatElapsed(elapsed)}</span>
      </div>
      <button type="button" aria-label={toggleLabel} title={toggleLabel} onClick={toggle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={running ? "M9 6v12m6-12v12" : "m9 5 10 7-10 7z"} />
        </svg>
      </button>
      <button type="button" aria-label="关闭计时" title={closeFailed ? "关闭失败，请重试" : "关闭计时"}
        onClick={() => { void onClose().catch(() => setCloseFailed(true)); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
      {closeFailed && <span className="sr-only" role="alert">关闭失败，请重试</span>}
    </main>
  );
}
