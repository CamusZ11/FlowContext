export interface DisclosureProps {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  headingId?: string;
  headingLevel?: 2 | 3;
}

export function Disclosure({ title, eyebrow, children, defaultOpen = false, headingId, headingLevel = 2 }: DisclosureProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        {headingId ? <Heading id={headingId}>{title}</Heading> : <span>{title}</span>}
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export type ConnectionState = "synced" | "reconnecting" | "failed";

const connectionCopy: Record<ConnectionState, string> = {
  synced: "已同步",
  reconnecting: "正在重连",
  failed: "连接失败",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return <span className={`connection-status connection-${state}`} data-testid="connection-status">{connectionCopy[state]}</span>;
}
