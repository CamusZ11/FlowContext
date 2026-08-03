import { useQuery } from "@tanstack/react-query";
import type { DailyProjection } from "@flowcontext/domain";
import { useFlowRepository } from "../../app/RepositoryContext";
import { Disclosure, type ConnectionState } from "./Disclosure";

export function useDailyProjection(date: string, enabled = true) {
  const repository = useFlowRepository();
  return useQuery({
    queryKey: ["daily-projection", date],
    queryFn: () => repository.getDailyProjection(date),
    enabled,
  });
}

export interface DailyLensProps {
  date: string;
  projection?: DailyProjection | null;
  connectionState?: ConnectionState;
}

export function DailyLens({ date, projection, connectionState = "synced" }: DailyLensProps) {
  const query = useDailyProjection(date, projection === undefined);
  const value = projection === undefined ? query.data : projection;
  return (
    <section className="daily-lens-section" aria-labelledby="daily-heading">
      <Disclosure title="Daily Lens" eyebrow={date} headingId="daily-heading">
        {query.isPending && projection === undefined ? <p role="status">加载中…</p> : null}
        {query.isError ? <p role="alert" className="error-text">连接失败，请重试</p> : null}
        <p className="connection-note" data-connection-state={connectionState}>{value?.dailyLens || "今天还没有 Daily Lens。"}</p>
      </Disclosure>
    </section>
  );
}
