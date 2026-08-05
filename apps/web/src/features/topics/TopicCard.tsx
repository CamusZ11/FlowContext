import type { DeviceWorkspace, TopicCard as TopicCardType } from "@flowcontext/domain";
import { buildCodexLink, topicNeedsWorkspace, type TopicLinkInput } from "./buildCodexLink";
import { ArrowRightIcon, CheckIcon } from "../../ui/icons";

export interface TopicCardProps {
  topic: TopicLinkInput | TopicCardType;
  currentWorkspace?: DeviceWorkspace | null;
  isContextLoading?: boolean;
  onOpen(url: string): Promise<void>;
}

export function TopicCardView({ topic, currentWorkspace = null, isContextLoading = false, onOpen }: TopicCardProps) {
  const input: TopicLinkInput = { ...topic, currentWorkspace: currentWorkspace ?? (topic as TopicLinkInput).currentWorkspace };
  const link = buildCodexLink(input);
  const missingWorkspace = topicNeedsWorkspace(input);
  const disabled = isContextLoading || !link || missingWorkspace;
  const actionLabel = isContextLoading
    ? "正在准备继续…"
    : link?.startsWith("codex://threads/")
    ? "打开当前任务"
    : "继续此主题";
  const note = isContextLoading
    ? "正在加载当前设备的继续信息"
    : missingWorkspace
    ? "下次 Handoff 将自动配置此设备"
    : !link
    ? "暂无可继续的任务记录"
    : null;

  return (
    <article className="topic-card" data-testid="topic-card">
      <div className="topic-card-body">
        <p className="eyebrow">TOPIC</p>
        <h3>{topic.title}</h3>
        <p className="topic-state">{topic.currentState || "尚未记录当前状态"}</p>
        {topic.nextAction ? <p className="topic-next"><CheckIcon width="18" height="18" /><span><strong>下一步：</strong>{topic.nextAction}</span></p> : null}
      </div>
      <div className="topic-card-footer">
        {note ? <p className="topic-workspace-note">{note}</p> : <span />}
        <button
          type="button"
          className="topic-action-button"
          disabled={disabled}
          onClick={() => { if (link) void onOpen(link); }}
        >
          <span>{actionLabel}</span><ArrowRightIcon width="18" height="18" />
        </button>
      </div>
    </article>
  );
}

export { TopicCardView as TopicCard };
