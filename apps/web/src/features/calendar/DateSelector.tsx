import { useEffect, useRef, useState } from "react";

export interface DateSelectorProps {
  mode: "web" | "desktop";
  value: string;
  onChange(value: string): void;
}

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function surroundingDates(value: string): string[] {
  const selected = localDate(value);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selected);
    date.setDate(selected.getDate() + index - 3);
    return formatLocalDate(date);
  });
}

function formatOptionLabel(value: string): string {
  const date = localDate(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month} / ${day} ${weekdays[date.getDay()]}`;
}

export function DateSelector({ mode, value, onChange }: DateSelectorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [month, day] = value.slice(5).split("-");

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isOpen]);

  return (
    <span ref={rootRef} className="date-selector" data-mode={mode}>
      <button
        type="button"
        className="todo-date-trigger"
        aria-label={`选择日期，当前 ${value}`}
        aria-expanded={isOpen}
        aria-controls="todo-date-options"
        onClick={() => setIsOpen((open) => !open)}
      >
        {month} <span aria-hidden="true">/</span> {day}
      </button>
      <input
        ref={inputRef}
        type="date"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        value={value}
        onChange={(event) => {
          if (event.target.value) {
            onChange(event.target.value);
            setIsOpen(false);
          }
        }}
      />
      {isOpen ? (
        <div id="todo-date-options" className="todo-date-popover" role="listbox" aria-label="选择日期">
          {surroundingDates(value).map((date) => (
            <button
              key={date}
              type="button"
              className="todo-date-option"
              role="option"
              aria-selected={date === value}
              onClick={() => {
                onChange(date);
                setIsOpen(false);
              }}
            >
              {formatOptionLabel(date)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
