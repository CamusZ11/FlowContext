import { useEffect, useId, useRef, useState } from "react";
import { localDate, offsetDate, weekdays } from "./calendarDates";

export interface DateSelectorProps {
  mode: "web" | "desktop";
  value: string;
  onChange(value: string): void;
}

function surroundingDates(value: string): string[] {
  return Array.from({ length: 7 }, (_, index) => offsetDate(value, index - 3));
}

function formatOptionLabel(value: string): string {
  const date = localDate(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month} / ${day} ${weekdays[date.getDay()]}`;
}

export function DateSelector({ mode, value, onChange }: DateSelectorProps) {
  const optionsId = useId();
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
        aria-controls={optionsId}
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
        <div id={optionsId} className="todo-date-popover" role="listbox" aria-label="选择日期">
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
