import type { DeviceWorkspace, TopicCard as TopicCardType } from "@flowcontext/domain";
import { buildCodexLink, topicNeedsWorkspace, type TopicLinkInput } from "./buildCodexLink";
import { ArrowRightIcon, CheckIcon } from "../../ui/icons";

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
      <div className="topic-card-body">
        <p className="eyebrow">TOPIC</p>
        <h3>{topic.title}</h3>
        <p className="topic-state">{topic.currentState || "尚未记录当前状态"}</p>
        {topic.nextAction ? <p className="topic-next"><CheckIcon width="18" height="18" /><span><strong>下一步：</strong>{topic.nextAction}</span></p> : null}
      </div>
      <div className="topic-card-footer">
        {missingWorkspace ? <p className="topic-workspace-note">先配置此设备项目路径</p> : <span />}
        <button
          type="button"
          className="topic-action-button"
          disabled={disabled}
          onClick={() => { if (link) void onOpen(link); }}
        >
          <span>{link?.startsWith("codex://threads/") ? "打开当前任务" : "继续此主题"}</span><ArrowRightIcon width="18" height="18" />
        </button>
      </div>
    </article>
  );
}

export { TopicCardView as TopicCard };
