import { createContext, useContext } from "react";
import type { FlowRepository } from "@flowcontext/data";

const RepositoryContext = createContext<FlowRepository | null>(null);

export const RepositoryProvider = RepositoryContext.Provider;

export function useFlowRepository(): FlowRepository {
  const repository = useContext(RepositoryContext);
  if (!repository) throw new Error("FlowRepository is not configured");
  return repository;
}
