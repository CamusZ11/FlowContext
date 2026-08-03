import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlowRepository } from "@flowcontext/data";
import type { PlatformPort } from "../platform/PlatformPort";
import { PlatformProvider } from "./PlatformContext";
import { RepositoryProvider } from "./RepositoryContext";

export interface AppProvidersProps {
  repository: FlowRepository;
  platform: PlatformPort;
  queryClient?: QueryClient;
  children: React.ReactNode;
}

export function AppProviders({
  repository,
  platform,
  queryClient,
  children,
}: AppProvidersProps) {
  const client = queryClient ?? defaultQueryClient;
  return (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={repository}>
        <PlatformProvider value={platform}>{children}</PlatformProvider>
      </RepositoryProvider>
    </QueryClientProvider>
  );
}

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
    mutations: { retry: 0 },
  },
});
