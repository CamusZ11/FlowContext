import { useRef } from "react";

export interface DateSelectorProps {
  mode: "web" | "desktop";
  value: string;
  onChange(value: string): void;
}

export function DateSelector({ mode, value, onChange }: DateSelectorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [month, day] = value.slice(5).split("-");

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Safari and permission-constrained WebViews can expose showPicker but reject it.
      }
    }
    input.click();
  }

  return (
    <div className="date-selector" data-mode={mode}>
      <button
        type="button"
        className="todo-date-trigger"
        aria-label={`选择日期，当前 ${value}`}
        onClick={openPicker}
      >
        {month} <span aria-hidden="true">/</span> {day}
      </button>
      <input
        ref={inputRef}
        type="date"
        aria-label="选择日期"
        className="sr-only"
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
      />
    </div>
  );
}
