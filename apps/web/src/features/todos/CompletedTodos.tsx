import type { Todo, TodoPatch } from "@flowcontext/domain";
import { TodoRow } from "./TodoRow";

export interface CompletedTodosProps {
  todos: Todo[];
  onUpdate(id: string, patch: TodoPatch): Promise<void>;
  onDelete(id: string): Promise<void>;
  onStartTimer?(todo: Todo): void;
  onOpenTimeHistory?(todo: Todo): void;
  disabled?: boolean;
}

export function CompletedTodos({ todos, onUpdate, onDelete, onStartTimer, onOpenTimeHistory, disabled }: CompletedTodosProps) {
  if (todos.length === 0) return null;
  return (
    <ul className="todo-list completed-todos" aria-label="已完成 To-do">
      {todos.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          onUpdate={(patch) => onUpdate(todo.id, patch)}
          onDelete={() => onDelete(todo.id)}
          onStartTimer={onStartTimer}
          onOpenTimeHistory={onOpenTimeHistory}
          disabled={disabled}
        />
      ))}
    </ul>
  );
}
