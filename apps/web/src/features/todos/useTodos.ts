import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sortTodosForDate, type Todo, type TodoCreate, type TodoPatch } from "@flowcontext/domain";
import { useFlowRepository } from "../../app/RepositoryContext";

export function todosQueryKey(date: string) {
  return ["todos", date] as const;
}

type PendingTodoPatch = { id: string; patch: TodoPatch };

function pendingTodoPatchesQueryKey(date: string) {
  return ["todos", date, "pending-patches"] as const;
}

function applyPendingPatches(todos: Todo[], patches: PendingTodoPatch[]) {
  return todos.map((todo) => {
    const pending = patches.find((patch) => patch.id === todo.id);
    return pending ? { ...todo, ...pending.patch } : todo;
  });
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
      const patches = queryClient.getQueryData<PendingTodoPatch[]>(pendingTodoPatchesQueryKey(date)) ?? [];
      queryClient.setQueryData(todosQueryKey(date), sortTodosForDate(applyPendingPatches(todos, patches), date));
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
    onMutate: ({ id, patch }) => {
      void queryClient.cancelQueries({ queryKey: todosQueryKey(date) });
      const previous = queryClient.getQueryData<Todo[]>(todosQueryKey(date));
      queryClient.setQueryData(todosQueryKey(date), (current: Todo[] | undefined) =>
        sortTodosForDate((current ?? []).map((todo) => todo.id === id ? { ...todo, ...patch } : todo), date));
      const previousPatches = queryClient.getQueryData<PendingTodoPatch[]>(pendingTodoPatchesQueryKey(date)) ?? [];
      const priorPatch = previousPatches.find((pending) => pending.id === id)?.patch;
      queryClient.setQueryData(
        pendingTodoPatchesQueryKey(date),
        [...previousPatches.filter((pending) => pending.id !== id), { id, patch: { ...priorPatch, ...patch } }],
      );
      return { previous, previousPatches };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(todosQueryKey(date), context?.previous);
      queryClient.setQueryData(pendingTodoPatchesQueryKey(date), context?.previousPatches ?? []);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(todosQueryKey(date), (current: Todo[] | undefined) =>
        sortTodosForDate([...(current ?? []).filter((todo) => todo.id !== updated.id), updated], date));
      queryClient.setQueryData(pendingTodoPatchesQueryKey(date), (current: PendingTodoPatch[] | undefined) =>
        (current ?? []).filter((pending) => pending.id !== updated.id));
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
