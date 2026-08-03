export type TopicState = "open" | "done";

export type ProjectLifecycleStatus = "inbox" | "active" | "paused" | "done" | "archived";

export interface ProjectProjection {
  id?: string | null;
  projectKey: string;
  title: string;
  lifecycleStatus: ProjectLifecycleStatus;
  summary: string;
  nextAction: string;
  sourcePath?: string;
  lastSyncedAt?: string | null;
}

export interface TopicCard {
  id: string;
  projectId: string;
  title: string;
  state: TopicState;
  currentState: string;
  nextAction: string;
  openQuestions: string[];
  latestHandoffId?: string | null;
  lastActiveAt: string;
  focusRank?: number | null;
  resurfaceAt?: string | null;
  resurfaceCondition?: string | null;
}

export interface Session {
  id: string;
  topicCardId: string;
  codexThreadId: string;
  deviceId: string;
  workspacePath: string;
  startedAt: string;
  endedAt?: string | null;
}

export interface Handoff {
  id: string;
  sessionId: string;
  topicCardId: string;
  content: string;
  idempotencyKey: string;
  createdAt?: string;
  generatedAt?: string;
}

export interface HandoffCreate {
  sessionId: string;
  topicCardId: string;
  content: string;
  idempotencyKey: string;
}

export interface Todo {
  id: string;
  title: string;
  plannedDate: string;
  plannedTime: string | null;
  isCompleted: boolean;
  projectId?: string | null;
  topicCardId?: string | null;
}

export type TodoCreate = Omit<Todo, "id">;

export type TodoPatch = Partial<Pick<Todo, "title" | "plannedDate" | "plannedTime" | "isCompleted" | "projectId" | "topicCardId">>;

export interface DailyProjection {
  date: string;
  dailyLens: string;
  projects: ProjectProjection[];
  macReport?: string | null;
  windowsReport?: string | null;
}

export type DevicePlatform = "macos" | "windows";

export interface DeviceWorkspace {
  deviceId: string;
  platform: DevicePlatform;
  projectId: string;
  workspacePath: string;
}

export interface HandoffUpdate {
  currentState?: string;
  nextAction?: string;
  openQuestions?: string[];
  latestHandoffId?: string | null;
  lastActiveAt?: string;
}
