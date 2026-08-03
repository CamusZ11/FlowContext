import type { FlowRepository } from "@flowcontext/data";
import { AppProviders } from "./AppProviders";
import type { PlatformPort } from "../platform/PlatformPort";
import { usePlatform } from "./PlatformContext";
import { DateSelector } from "../features/calendar/DateSelector";
import { useSelectedDate } from "../features/calendar/useSelectedDate";
import { TodoSection } from "../features/todos/TodoSection";
import { SuggestedTopics } from "../features/topics/SuggestedTopics";
import { CodexReports } from "../features/daily/CodexReports";
import { DailyLens, useDailyProjection } from "../features/daily/DailyLens";
import { ProjectGroups } from "../features/daily/ProjectGroups";
import { ConnectionStatus } from "../features/daily/Disclosure";
import { AuthGate } from "../features/auth/AuthGate";
import type { AuthPort } from "../features/auth/useAuth";

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
        <p className="eyebrow">FLOWCONTEXT</p>
        <h1>今天，继续推进</h1>
        <div className="header-actions">
          <DateSelector mode={mode} value={selectedDate} onChange={setSelectedDate} />
          <ConnectionStatus state={connectionState} />
        </div>
      </header>
      <TodoSection date={selectedDate} />
      <SuggestedTopics deviceId={platform.deviceId} />
      <DailyLens date={selectedDate} projection={projection} connectionState={connectionState} />
      <CodexReports projection={projection} />
      <ProjectGroups projection={projection} />
    </main>
  );
}
