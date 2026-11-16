import { useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { TODO_CATEGORIES, todoCategorySchema, type Todo, type TodoCategory, type TodoPatch } from "@flowcontext/domain";
import { localDate, offsetDate, weekdays } from "../calendar/calendarDates";
import { useCalendarTodos } from "./useTodos";
import { TodoTimerButton } from "./TodoTimer";
import "./todo-calendar.css";

const firstHour = 7;
const lastHour = 23;
const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => i + firstHour);
const gridMinutes = (lastHour - firstHour) * 60;
const weekMedia = "(min-width: 860px)";
const categoryLabels: Record<TodoCategory, string> = { work: "工作", study: "学习", daily: "日常", health: "健康" };
const invalidTimeRange = "结束时间必须晚于开始时间";

interface Slot {
  date: string;
  minute: number;
}

type Edge = "开始" | "结束";
type Placement = Slot & { endMinute?: number };
type TaskDrag = { todo: Todo; edge?: Edge; grabOffset: number; pointerId: number; x: number; y: number; moved: boolean };

function timeMinute(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour - firstHour) * 60 + minute;
}

function formatTime(minute: number) {
  const minutesSinceMidnight = firstHour * 60 + minute;
  const hour = String(Math.floor(minutesSinceMidnight / 60)).padStart(2, "0");
  return `${hour}:${String(minutesSinceMidnight % 60).padStart(2, "0")}`;
}

function slotAtPoint(x: number, y: number): Slot | null {
  const day = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-calendar-date]");
  if (!day) return null;
  const bounds = day.getBoundingClientRect();
  const minutes = (y - bounds.top) / bounds.height * gridMinutes;
  return { date: day.dataset.calendarDate!, minute: Math.max(0, Math.min(gridMinutes, Math.round(minutes / 15) * 15)) };
}

function dragPlacement({ todo, edge, grabOffset }: TaskDrag, slot: Slot): Placement | null {
  const endMinute = todo.plannedEndTime ? timeMinute(todo.plannedEndTime) : undefined;
  if (!edge) {
    if (endMinute === undefined || !todo.plannedTime) return slot;
    const startMinute = timeMinute(todo.plannedTime);
    const duration = endMinute - startMinute;
    const minute = duration > gridMinutes ? startMinute : Math.max(0, Math.min(slot.minute - grabOffset, gridMinutes - duration));
    return { ...slot, minute, endMinute: minute + duration };
  }
  if (slot.date !== todo.plannedDate || !todo.plannedTime) return null;
  const startMinute = timeMinute(todo.plannedTime);
  const end = endMinute ?? Math.min(startMinute + 30, gridMinutes);
  if (edge === "开始" && end > 0) return { ...slot, minute: Math.min(slot.minute, end - Math.min(15, end)), endMinute: end };
  if (edge === "结束" && startMinute < gridMinutes) {
    return { ...slot, minute: startMinute, endMinute: Math.max(slot.minute, Math.min(startMinute + 15, gridMinutes)) };
  }
  return null;
}

function subscribeToWidth(onChange: () => void) {
  const media = window.matchMedia(weekMedia);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isWeekWidth() {
  return window.matchMedia(weekMedia).matches;
}

interface CalendarTask {
  todo: Todo;
  minute: number;
  endMinute?: number;
  lane: number;
}

function placeTasks(todos: Todo[]) {
  const tasks = todos.flatMap((todo) => {
    const time = todo.plannedTime;
    if (!time || time > "23:00" || (time < "07:00" && (!todo.plannedEndTime || todo.plannedEndTime <= "07:00"))) return [];
    const endMinute = todo.plannedEndTime ? Math.min(gridMinutes, timeMinute(todo.plannedEndTime)) : undefined;
    return [{ todo, minute: Math.max(0, timeMinute(time)), endMinute, lane: 0 }];
  }).sort((a, b) => a.minute - b.minute);

  const groups: { tasks: CalendarTask[]; laneEnds: number[] }[] = [];
  for (const task of tasks) {
    let group = groups.at(-1);
    if (!group || group.laneEnds.every((end) => end <= task.minute)) {
      group = { tasks: [], laneEnds: [] };
      groups.push(group);
    }
    const freeLane = group.laneEnds.findIndex((end) => end <= task.minute);
    task.lane = freeLane < 0 ? group.laneEnds.length : freeLane;
    // A 21px card spans 42 minutes at the minimum 30px/hour scale.
    group.laneEnds[task.lane] = Math.max(task.endMinute ?? 0, task.minute + 42);
    group.tasks.push(task);
  }
  return groups;
}

function calendarPosition(minute: number) {
  return `${minute / gridMinutes * 100}%`;
}

function stepThroughSlots(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const current = event.currentTarget;
  const adjacent = event.key === "ArrowUp" ? current.previousElementSibling : current.nextElementSibling;
  if (adjacent instanceof HTMLButtonElement) adjacent.focus();
}

interface TodoCalendarProps {
  date: string;
  today: string;
  todos: Todo[];
  busy: boolean;
  expandedWeek: boolean;
  openingWeek: boolean;
  onOpenWeek?(): void;
  onStartTimer?(todo: Todo): void;
  onOpenTimeHistory?(todo: Todo): void;
  onDateChange(date: string): void;
  onSelectSlot(date: string, time: string): void;
  onUpdate(todo: Todo, patch: TodoPatch): Promise<void>;
}

export function TodoCalendar({ date, today, todos, busy, expandedWeek, openingWeek, onOpenWeek, onStartTimer, onOpenTimeHistory, onDateChange, onSelectSlot, onUpdate }: TodoCalendarProps) {
  const wideViewport = useSyncExternalStore(subscribeToWidth, isWeekWidth);
  const showWeek = expandedWeek || wideViewport;
  const weekday = (localDate(date).getDay() + 6) % 7;
  const dates = showWeek ? Array.from({ length: 7 }, (_, i) => offsetDate(date, i - weekday)) : [date];
  const otherDates = dates.filter((day) => day !== date);
  const weekQueries = useCalendarTodos(otherDates);
  const todosByDate = new Map(otherDates.map((day, i) => [day, weekQueries[i].data]));
  todosByDate.set(date, todos);
  const untimedByDate = dates.map((day) => (todosByDate.get(day) ?? []).filter((todo) => !todo.plannedTime));
  const untimedRows = Math.min(3, Math.max(...untimedByDate.map((items) => items.length)));
  const step = showWeek ? 7 : 1;
  const drag = useRef<TaskDrag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Placement | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveTask(todo: Todo, patch: TodoPatch, failureMessage: string) {
    if (busy) return;
    setError(null);
    try {
      await onUpdate(todo, patch);
      setEditing((current) => current?.id === todo.id ? { ...current, ...patch } : current);
    } catch {
      setError(failureMessage);
    }
  }

  function saveSchedule(todo: Todo, nextDate: string, time: string | null, endTime?: string | null) {
    if (busy) return;
    if (endTime && (!time || endTime <= time)) {
      setError(invalidTimeRange);
      return;
    }
    const patch: TodoPatch = {};
    if (todo.plannedDate !== nextDate) patch.plannedDate = nextDate;
    if (todo.plannedTime !== time) patch.plannedTime = time;
    if (endTime !== undefined && todo.plannedEndTime !== endTime) patch.plannedEndTime = endTime;
    if (Object.keys(patch).length === 0) {
      setError((current) => current === invalidTimeRange ? null : current);
      return;
    }
    void saveTask(todo, patch, "时间调整失败，请重试");
  }

  function saveEditorSchedule(todo: Todo, form: HTMLFormElement) {
    if (busy || !form.checkValidity()) return;
    const fields = new FormData(form);
    const start = String(fields.get("time")) || null;
    const end = fields.get("end");
    if (!start && end) {
      const endInput = form.elements.namedItem("end");
      if (endInput instanceof HTMLInputElement) endInput.value = "";
    }
    saveSchedule(todo, String(fields.get("date")), start, end === null ? undefined : start && (String(end) || null));
  }

  async function setCompleted(todo: Todo, isCompleted: boolean) {
    setError(null);
    try {
      await onUpdate(todo, { isCompleted });
    } catch {
      setError("完成状态保存失败，请重试");
    }
  }

  function startDrag(event: PointerEvent<HTMLElement>, todo: Todo, edge?: Edge) {
    if (busy || !event.isPrimary || event.button !== 0) return;
    const { pointerId, clientX: x, clientY: y } = event;
    const slot = !edge && todo.plannedEndTime && todo.plannedTime ? slotAtPoint(x, y) : null;
    const grabOffset = slot && todo.plannedTime ? slot.minute - timeMinute(todo.plannedTime) : 0;
    event.currentTarget.setPointerCapture(pointerId);
    drag.current = { todo, edge, grabOffset, pointerId, x, y, moved: false };
    suppressClick.current = false;
  }

  function moveDrag(event: PointerEvent) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return;
    active.moved = true;
    suppressClick.current = true;
    const slot = slotAtPoint(event.clientX, event.clientY);
    setPreview(slot && dragPlacement(active, slot));
  }

  function cancelDrag() {
    drag.current = null;
    setPreview(null);
  }

  function endDrag(event: PointerEvent) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancelDrag();
    const slot = active.moved && slotAtPoint(event.clientX, event.clientY);
    const placement = slot && dragPlacement(active, slot);
    if (placement) {
      setEditing((current) => current?.id === active.todo.id ? null : current);
      saveSchedule(active.todo, placement.date, formatTime(placement.minute),
        placement.endMinute === undefined ? undefined : formatTime(placement.endMinute));
    }
  }

  function selectSlot(event: MouseEvent, day: string, hour: number) {
    const slot = event.detail === 0 ? { date: day, minute: (hour - firstHour) * 60 } : slotAtPoint(event.clientX, event.clientY);
    if (slot) onSelectSlot(slot.date, formatTime(slot.minute));
  }

  function taskCard(todo: Todo, style?: CSSProperties) {
    const timeLabel = todo.plannedEndTime ? `${todo.plannedTime}–${todo.plannedEndTime}` : todo.plannedTime;
    const categoryLabel = todo.category ? categoryLabels[todo.category] : undefined;
    const tooltip = [timeLabel, todo.title, categoryLabel].filter(Boolean).join(" · ");
    const canResize = Boolean(style && todo.plannedTime && todo.plannedEndTime !== undefined);
    return (
      <li key={todo.id} className={`todo-calendar-task${style ? " todo-calendar-timed" : ""}`} style={style}
        data-completed={todo.isCompleted} data-category={todo.category ?? undefined}>
        <input type="checkbox" aria-label={`完成 ${todo.title}`} checked={todo.isCompleted} disabled={busy}
          onChange={(event) => void setCompleted(todo, event.target.checked)} />
        <button type="button" className="todo-calendar-task-body" disabled={busy}
          title={tooltip}
          onPointerDown={(event) => startDrag(event, todo)} onLostPointerCapture={cancelDrag}
          onClick={() => { setError(null); setEditing((current) => current?.id === todo.id ? null : todo); }}>
          <span className="todo-calendar-task-title">{todo.title}</span>
          {timeLabel && <time dateTime={todo.plannedTime ?? undefined}>{timeLabel}</time>}
        </button>
        {onStartTimer && <TodoTimerButton title={todo.title} onClick={() => onStartTimer(todo)} />}
        {canResize && !busy && (["开始", "结束"] as const).map((edge) => (
          <span key={edge} className="todo-calendar-resize" data-resize-edge={edge} title={`拖动调整${edge}时间`}
            onPointerDown={(event) => startDrag(event, todo, edge)} onLostPointerCapture={cancelDrag} />
        ))}
      </li>
    );
  }

  return (
    <div className="todo-calendar" data-expanded-week={expandedWeek || undefined} role="region" aria-label="任务日历"
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || (!drag.current && !editing)) return;
        event.preventDefault();
        cancelDrag();
        setEditing(null);
      }}
      onClickCapture={(event) => {
        if (event.detail === 0 || !suppressClick.current) return;
        suppressClick.current = false;
        event.stopPropagation();
      }}
      onPointerDownCapture={() => { suppressClick.current = false; }}>
      <div className="todo-calendar-toolbar" role="group" aria-label="日历导航">
        <button type="button" onClick={() => onDateChange(today)}>今天</button>
        <button type="button" aria-label={showWeek ? "上一周" : "前一天"} onClick={() => onDateChange(offsetDate(date, -step))}>
          <span aria-hidden="true">‹</span>
        </button>
        <button type="button" aria-label={showWeek ? "下一周" : "后一天"} onClick={() => onDateChange(offsetDate(date, step))}>
          <span aria-hidden="true">›</span>
        </button>
        {showWeek && <span className="todo-calendar-week-range">{dates[0]} ~ {dates[6]}</span>}
        {onOpenWeek && <button type="button" className="todo-calendar-open-week" disabled={openingWeek} onClick={onOpenWeek}>周视图</button>}
      </div>
      {weekQueries.some((query) => query.isPending) && <p role="status" className="todo-calendar-status">加载本周任务…</p>}
      {weekQueries.some((query) => query.isError) && (
        <p role="alert" className="error-text todo-calendar-status">部分日期加载失败 <button type="button" onClick={() => {
          for (const query of weekQueries) if (query.isError) void query.refetch();
        }}>重试</button></p>
      )}
      {error && <p role="alert" className="error-text todo-calendar-status">{error}</p>}
      {editing && (
        <form key={editing.id} className="todo-calendar-editor" aria-label="调整任务时间"
          onSubmit={(event) => event.preventDefault()}
          onBlur={(event) => {
            if (event.target instanceof HTMLInputElement) saveEditorSchedule(editing, event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              event.target.blur();
            }
          }}>
          <span title={editing.title}>{editing.title}</span>
          <input type="date" name="date" aria-label="任务日期" defaultValue={editing.plannedDate} required disabled={busy} />
          <input type="time" name="time" aria-label="任务时间" defaultValue={editing.plannedTime ?? ""} disabled={busy} autoFocus />
          {editing.plannedEndTime !== undefined && <input type="time" name="end" aria-label="结束时间" defaultValue={editing.plannedEndTime ?? ""} disabled={busy} />}
          {editing.category !== undefined && (
            <select aria-label="分类" value={editing.category ?? ""} disabled={busy} onChange={(event) => {
              const category = todoCategorySchema.parse(event.currentTarget.value || null);
              void saveTask(editing, { category }, "任务保存失败，请重试");
            }}>
              <option value="">未分类</option>
              {TODO_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
            </select>
          )}
          {onOpenTimeHistory && <button type="button" onClick={() => onOpenTimeHistory(editing)}>计时记录</button>}
        </form>
      )}
      <div className="todo-calendar-grid-scroll">
        <div className="todo-calendar-grid" style={{ "--days": dates.length, "--untimed-height": `${untimedRows ? untimedRows * 25 + 6 : 0}px` } as CSSProperties}>
          <div className="todo-calendar-corner" aria-hidden="true" />
          {dates.map((day) => {
            const label = <><span>{weekdays[localDate(day).getDay()]}</span><time dateTime={day}>{Number(day.slice(8))}</time></>;
            const current = day === today ? "date" : undefined;
            return showWeek ? (
              <button key={day} type="button" className="todo-calendar-date" aria-label={day}
                aria-pressed={day === date} aria-current={current} onClick={() => onDateChange(day)}>{label}</button>
            ) : <div key={day} className="todo-calendar-date" aria-current={current}>{label}</div>;
          })}
          <div className="todo-calendar-untimed-label" aria-hidden="true">{untimedRows > 0 && "待排"}</div>
          {dates.map((day, index) => (
            <ul key={day} className="todo-calendar-untimed" role="list" aria-label={`${day} 的未排时间任务`} aria-hidden={!untimedRows}>
              {untimedByDate[index].map((todo) => taskCard(todo))}
            </ul>
          ))}
          <div className="todo-calendar-hours" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} style={{ top: calendarPosition((hour - firstHour) * 60) }}>{formatTime((hour - firstHour) * 60)}</span>
            ))}
          </div>
          {dates.map((day) => (
            <div className="todo-calendar-day" key={day} data-calendar-date={day}>
              {hours.map((hour) => (
                <button key={hour} type="button" className="todo-calendar-slot" disabled={busy}
                  aria-label={`${day} ${formatTime((hour - firstHour) * 60)} 创建日程`}
                  tabIndex={hour === firstHour ? 0 : -1}
                  style={{ top: calendarPosition((hour - firstHour) * 60) }}
                  onKeyDown={stepThroughSlots}
                  onClick={(event) => selectSlot(event, day, hour)} />
              ))}
              <ul className="todo-calendar-events" role="list" aria-label={`${day} 的定时任务`}>
                {placeTasks(todosByDate.get(day) ?? []).flatMap(({ tasks, laneEnds }) => tasks.map(({ todo, minute, endMinute, lane }) => taskCard(todo, {
                  top: calendarPosition(minute),
                  height: endMinute === undefined ? undefined : `calc(${calendarPosition(endMinute - minute)} - 3px)`,
                  left: `${lane / laneEnds.length * 100}%`,
                  width: `${100 / laneEnds.length}%`,
                })))}
              </ul>
              {preview?.date === day && (
                <span className="todo-calendar-drop" style={{
                  top: calendarPosition(Math.max(0, preview.minute)),
                  height: preview.endMinute === undefined ? undefined : calendarPosition(Math.min(gridMinutes, preview.endMinute) - Math.max(0, preview.minute)),
                }}>{formatTime(preview.minute)}{preview.endMinute === undefined ? "" : `–${formatTime(preview.endMinute)}`}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
