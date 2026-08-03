import type { DeviceWorkspace, TopicCard as TopicCardType } from "@flowcontext/domain";
import { buildCodexLink, topicNeedsWorkspace, type TopicLinkInput } from "./buildCodexLink";

export interface TopicCardProps {
  topic: TopicLinkInput | TopicCardType;
  currentWorkspace?: DeviceWorkspace | null;
  onOpen(url: string): Promise<void>;
}

export function TopicCardView({ topic, currentWorkspace = null, onOpen }: TopicCardProps) {
  const input: TopicLinkInput = { ...topic, currentWorkspace: currentWorkspace ?? (topic as TopicLinkInput).currentWorkspace };
  const link = buildCodexLink(input);
  const missingWorkspace = topicNeedsWorkspace(input);
  const disabled = !link || missingWorkspace;

  return (
    <article className="topic-card" data-testid="topic-card">
      <div>
        <p className="eyebrow">TOPIC</p>
        <h3>{topic.title}</h3>
        <p className="topic-state">{topic.currentState || "尚未记录当前状态"}</p>
        {topic.nextAction ? <p className="topic-next"><strong>下一步：</strong>{topic.nextAction}</p> : null}
      </div>
      {missingWorkspace ? <p className="muted">先配置此设备项目路径</p> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (link) void onOpen(link); }}
      >
        {link?.startsWith("codex://threads/") ? "打开当前任务" : "继续此主题"}
      </button>
    </article>
  );
}

export { TopicCardView as TopicCard };
