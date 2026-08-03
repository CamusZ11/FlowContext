import type { DeviceWorkspace, Handoff, Session, TopicCard } from "@flowcontext/domain";

export interface TopicLinkInput extends TopicCard {
  latestSession?: Session | null;
  latestHandoff?: Handoff | null;
  currentWorkspace?: DeviceWorkspace | null;
  codexThreadId?: string | null;
  workspacePath?: string | null;
  handoff?: Handoff | null;
}

function contextOf(input: TopicLinkInput) {
  const latestSession = input.latestSession ?? null;
  const latestHandoff = input.latestHandoff ?? input.handoff ?? null;
  const threadId = input.codexThreadId ?? latestSession?.codexThreadId ?? null;
  // Never reuse a path from the latest session: it may belong to another
  // platform. A new task is allowed only with an explicitly configured path
  // for the current device.
  const workspacePath = input.currentWorkspace?.workspacePath ?? input.workspacePath ?? null;
  return { latestHandoff, threadId, workspacePath };
}

/**
 * Build the official Codex deep link without sending a prompt automatically.
 * A live session resumes its thread; a handed-off session starts a pre-filled
 * task on the current device workspace.
 */
export function buildCodexLink(input: TopicLinkInput): string | null {
  const { latestHandoff, threadId, workspacePath } = contextOf(input);
  if (!latestHandoff && threadId) return `codex://threads/${encodeURIComponent(threadId)}`;
  if (!latestHandoff || !workspacePath) return null;

  const prompt = [
    `继续主题：${input.title}`,
    "下一步：",
    input.nextAction || "请先阅读交接内容并确认下一步。",
    "",
    "最新交接：",
    latestHandoff.content,
  ].join("\n");
  const url = new URL("codex://new");
  url.searchParams.set("path", workspacePath);
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

export function topicNeedsWorkspace(input: TopicLinkInput): boolean {
  return Boolean((input.latestHandoff ?? input.handoff) && !(input.currentWorkspace?.workspacePath ?? input.workspacePath));
}
