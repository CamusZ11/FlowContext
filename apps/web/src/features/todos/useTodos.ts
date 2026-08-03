import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sortTodosForDate, type Todo, type TodoCreate, type TodoPatch } from "@flowcontext/domain";
import { useFlowRepository } from "../../app/RepositoryContext";

export function todosQueryKey(date: string) {
  return ["todos", date] as const;
}

export function useTodos(date: string) {
  const repository = useFlowRepository();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: todosQueryKey(date),
    queryFn: async () => sortTodosForDate(await repository.listTodos(date), date),
  });

  useEffect(() => {
    const cleanup = repository.subscribeTodos(date, (todos) => {
      queryClient.setQueryData(todosQueryKey(date), sortTodosForDate(todos, date));
    });
    return cleanup;
  }, [date, queryClient, repository]);

  return query;
}

export function useTodoMutations(date: string) {
  const repository = useFlowRepository();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: todosQueryKey(date) });

  const create = useMutation({
    mutationFn: (input: TodoCreate) => repository.createTodo(input),
    onSuccess: (created) => {
      queryClient.setQueryData(todosQueryKey(date), (current: Todo[] | undefined) =>
        sortTodosForDate([...(current ?? []), created], date));
      return invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TodoPatch }) => repository.updateTodo(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(todosQueryKey(date), (current: Todo[] | undefined) =>
        sortTodosForDate([...(current ?? []).filter((todo) => todo.id !== updated.id), updated], date));
      return invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteTodo(id),
    onSuccess: (_value, id) => {
      queryClient.setQueryData(todosQueryKey(date), (current: Todo[] | undefined) =>
        (current ?? []).filter((todo) => todo.id !== id));
      return invalidate();
    },
  });

  return { create, update, remove };
}
