import type {
  DailyProjection,
  DeviceWorkspace,
  Handoff,
  Session,
  Todo,
  TodoCreate,
  TodoPatch,
  TopicCard,
} from "@flowcontext/domain";

export interface TopicContext {
  topic: TopicCard;
  latestSession: Session | null;
  latestHandoff: Handoff | null;
  currentWorkspace: DeviceWorkspace | null;
}

export type TodoListener = (todos: Todo[]) => void;
export type TodoSubscriptionCleanup = () => void;

export interface FlowRepositoryCapabilities {
  todoRollover: boolean;
}

/**
 * Stable frontend data port. Backend transports stay behind this interface;
 * UI code only sees domain values.
 */
export interface FlowRepository {
  readonly capabilities: FlowRepositoryCapabilities;
  listTodos(date: string): Promise<Todo[]>;
  createTodo(input: TodoCreate): Promise<Todo>;
  updateTodo(id: string, patch: TodoPatch): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
  rolloverIncompleteTodos(fromDate: string, toDate: string): Promise<Todo[]>;
  subscribeTodos(date: string, listener: TodoListener): TodoSubscriptionCleanup;
  listSuggestedTopics(limit: number): Promise<TopicCard[]>;
  getTopicContext(topicId: string, deviceId?: string): Promise<TopicContext | null>;
  getDailyProjection(date: string): Promise<DailyProjection | null>;
}
