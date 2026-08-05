import type { FlowRepository } from "@flowcontext/data";
import { AppProviders } from "./AppProviders";
import type { PlatformPort } from "../platform/PlatformPort";
import { usePlatform } from "./PlatformContext";
import { useSelectedDate } from "../features/calendar/useSelectedDate";
import { TodoSection } from "../features/todos/TodoSection";
import { SuggestedTopics } from "../features/topics/SuggestedTopics";
import { CodexReports } from "../features/daily/CodexReports";
import { DailyLens, useDailyProjection } from "../features/daily/DailyLens";
import { ProjectGroups } from "../features/daily/ProjectGroups";
import { ConnectionStatus } from "../features/daily/Disclosure";
import { AuthGate } from "../features/auth/AuthGate";
import type { AuthPort } from "../features/auth/useAuth";
import { FlowContextMark, SyncedCloudIcon } from "../ui/icons";

export interface AppProps {
  mode?: "web" | "desktop";
  repository: FlowRepository;
  platform: PlatformPort;
  auth?: AuthPort;
}

export function App({ mode = "web", repository, platform, auth }: AppProps) {
  const content = (
    <AppProviders repository={repository} platform={{ ...platform, mode }}>
      <AppContent mode={mode} />
    </AppProviders>
  );
  return auth ? <AuthGate auth={auth}>{content}</AuthGate> : content;
}

function AppContent({ mode }: { mode: "web" | "desktop" }) {
  const platform = usePlatform();
  const [selectedDate, setSelectedDate] = useSelectedDate(mode, platform);
  const projectionQuery = useDailyProjection(selectedDate);
  const connectionState = projectionQuery.isError ? "failed" : "synced" as const;
  const projection = projectionQuery.data ?? null;
  return (
    <main className="flowcontext-app" data-mode={mode}>
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-lockup">
            <FlowContextMark data-testid="flowcontext-mark" width="20" height="20" />
            <p className="eyebrow">FLOWCONTEXT</p>
          </div>
          <div className="brand-meta">
            <div className="header-actions">
              <SyncedCloudIcon data-testid="synced-mark" className="status-icon" width="19" height="19" />
              <ConnectionStatus state={connectionState} />
            </div>
          </div>
        </div>
      </header>
      <TodoSection date={selectedDate} onDateChange={setSelectedDate} />
      <SuggestedTopics deviceId={platform.deviceId} />
      <DailyLens date={selectedDate} projection={projection} connectionState={connectionState} />
      <CodexReports projection={projection} />
      <ProjectGroups projection={projection} />
    </main>
  );
}
