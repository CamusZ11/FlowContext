import { todosQueryKey } from "../features/todos/useTodos";

/** Query families whose server values become authoritative whenever a hidden
 * desktop panel is revealed. SSE remains the low-latency path; this closes
 * gaps after sleep, reconnect, or a long-hidden WebView. */
export function desktopRefreshQueryKeys(date: string): readonly (readonly string[])[] {
  return [
    todosQueryKey(date),
    ["suggested-topics"],
    ["suggested-topic-contexts"],
    ["daily-projection", date],
  ];
}
