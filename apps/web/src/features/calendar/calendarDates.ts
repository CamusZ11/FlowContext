export const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function offsetDate(value: string, offset: number): string {
  const date = localDate(value);
  date.setDate(date.getDate() + offset);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
