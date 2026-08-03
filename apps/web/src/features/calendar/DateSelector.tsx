export interface DateSelectorProps {
  mode: "web" | "desktop";
  value: string;
  onChange(value: string): void;
}

export function DateSelector({ mode, value, onChange }: DateSelectorProps) {
  if (mode === "desktop") return null;
  return (
    <label className="date-selector">
      <span>查看日期</span>
      <input
        type="date"
        aria-label="选择日期"
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
      />
    </label>
  );
}
