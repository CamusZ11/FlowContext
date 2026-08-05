import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeviceWorkspace, TopicCard } from "@flowcontext/domain";
import { useFlowRepository } from "../../app/RepositoryContext";
import { usePlatform } from "../../app/PlatformContext";
import { TopicCardView } from "./TopicCard";
import type { TopicLinkInput } from "./buildCodexLink";

export function rankSuggestedTopics(topics: readonly TopicCard[], now = new Date()): TopicCard[] {
  const nowTime = now.getTime();
  return [...topics].sort((left, right) => {
    const leftFocus = left.focusRank ?? Number.POSITIVE_INFINITY;
    const rightFocus = right.focusRank ?? Number.POSITIVE_INFINITY;
    if (leftFocus !== rightFocus) return leftFocus - rightFocus;

    const leftResurface = left.resurfaceAt ? Date.parse(left.resurfaceAt) <= nowTime : false;
    const rightResurface = right.resurfaceAt ? Date.parse(right.resurfaceAt) <= nowTime : false;
    if (leftResurface !== rightResurface) return leftResurface ? -1 : 1;

    const leftClearNext = left.nextAction.trim().length > 0;
    const rightClearNext = right.nextAction.trim().length > 0;
    if (leftClearNext !== rightClearNext) return leftClearNext ? -1 : 1;

    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

export interface SuggestedTopicsProps {
  topics?: TopicCard[];
  deviceId?: string;
  deviceWorkspace?: DeviceWorkspace | null;
  topicContexts?: Record<string, Partial<TopicLinkInput>>;
}

export function SuggestedTopics({ topics, deviceId, deviceWorkspace = null, topicContexts = {} }: SuggestedTopicsProps) {
  const repository = useFlowRepository();
  const platform = usePlatform();
  const query = useQuery({
    queryKey: ["suggested-topics"],
    queryFn: () => repository.listSuggestedTopics(12),
    enabled: topics === undefined,
  });
  const contextQuery = useQuery({
    queryKey: ["suggested-topic-contexts", deviceId, query.data?.map((topic) => topic.id)],
    queryFn: async () => Promise.all((query.data ?? []).map((topic) => repository.getTopicContext(topic.id, deviceId))),
    enabled: topics === undefined && Boolean(query.data),
  });
  const resolvedTopics = useMemo(() => {
    const base = topics ?? query.data ?? [];
    const contextById = new Map((contextQuery.data ?? []).filter((value) => value !== null).map((value) => [value!.topic.id, value!]));
    return base.map((topic) => {
      const context = contextById.get(topic.id);
      return {
        ...topic,
        ...(context?.topic ?? {}),
        latestSession: context?.latestSession ?? undefined,
        latestHandoff: context?.latestHandoff ?? undefined,
        currentWorkspace: context?.currentWorkspace ?? undefined,
        ...(topicContexts[topic.id] ?? {}),
      };
    });
  }, [contextQuery.data, query.data, topicContexts, topics]);
  const ranked = useMemo(() => rankSuggestedTopics(resolvedTopics).slice(0, 3), [resolvedTopics]);

  return (
    <section aria-labelledby="topic-heading" className="content-section topics-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">CONTINUITY</p>
          <h2 id="topic-heading">建议继续</h2>
        </div>
        <span className="section-count">{ranked.length}</span>
      </div>
      {query.isPending && topics === undefined ? <p role="status">加载中…</p> : null}
      {query.isError ? <p role="alert" className="error-text">加载失败，请重试</p> : null}
      <div className="topic-grid">
        {ranked.map((topic) => (
          <TopicCardView
            key={topic.id}
            topic={{ ...topic, ...topicContexts[topic.id] }}
            currentWorkspace={deviceWorkspace}
            isContextLoading={topics === undefined && contextQuery.isPending}
            onOpen={(url) => platform.openExternal(url)}
          />
        ))}
      </div>
      {!query.isPending && ranked.length === 0 ? <p className="empty-state">暂时没有需要继续的主题。</p> : null}
    </section>
  );
}
