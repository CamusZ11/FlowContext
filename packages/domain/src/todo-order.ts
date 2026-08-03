import { isoDateSchema } from "./schemas.ts";
import type { Todo } from "./types.ts";

type TodoRow = Pick<Todo, "id" | "plannedDate" | "plannedTime" | "isCompleted">;

/**
 * Return only the requested day's todos in the product order:
 * timed incomplete, untimed incomplete, then completed.
 */
export function sortTodosForDate<T extends TodoRow>(rows: readonly T[], date: string): T[] {
  isoDateSchema.parse(date);

  return rows
    .filter((row) => row.plannedDate === date)
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftRank = left.row.isCompleted ? 2 : left.row.plannedTime === null ? 1 : 0;
      const rightRank = right.row.isCompleted ? 2 : right.row.plannedTime === null ? 1 : 0;

      if (leftRank !== rightRank) return leftRank - rightRank;
      if (leftRank === 0) {
        const leftTime = left.row.plannedTime ?? "";
        const rightTime = right.row.plannedTime ?? "";
        const byTime = leftTime.localeCompare(rightTime);
        if (byTime !== 0) return byTime;
      }

      return left.index - right.index;
    })
    .map(({ row }) => row);
}
