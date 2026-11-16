import { createRoot } from "react-dom/client";
import type { FlowRepository } from "@flowcontext/data";
import { HttpFlowRepository } from "@flowcontext/data";
import type { Todo, TodoCreate, TodoPatch, TopicCard } from "@flowcontext/domain";
import { App } from "./app/App";
import { TodoTimer } from "./features/todos/TodoTimer";
import {
  createHttpAuth,
  DEVICE_TOKEN_STORAGE_KEY,
  type AuthPort,
} from "./features/auth/useAuth";
import { createRuntimePlatform } from "./platform/tauriPlatform";
import { getBootstrapErrorDetail, type BootstrapErrorKind } from "./bootstrapMessages";
import "./styles/tokens.css";
import "./styles/layout.css";

function createMemoryRepository(seed: Todo[] = [], rejectUpdates = false, topics: TopicCard[] = []): FlowRepository {
  let nextId = 1;
  let todos: Todo[] = seed.map((todo) => ({ category: null, ...todo }));
  const listeners = new Set<(date: string) => void>();
  const notify = (date: string) => listeners.forEach((listener) => listener(date));
  return {
    capabilities: { todoRollover: true },
    listTodos: async (date) => todos.filter((todo) => todo.plannedDate === date),
    createTodo: async (input: TodoCreate) => {
      const todo: Todo = { plannedEndTime: null, category: null, ...input, id: `e2e-${nextId++}` };
      todos = [...todos, todo];
      notify(todo.plannedDate);
      return todo;
    },
    updateTodo: async (id: string, patch: TodoPatch) => {
      if (rejectUpdates) throw new Error("network failure");
      const old = todos.find((todo) => todo.id === id);
      if (!old) throw new Error("todo not found");
      const next = { ...old, ...patch };
      todos = todos.map((todo) => todo.id === id ? next : todo);
      notify(old.plannedDate);
      if (next.plannedDate !== old.plannedDate) notify(next.plannedDate);
      return next;
    },
    deleteTodo: async (id: string) => {
      const old = todos.find((todo) => todo.id === id);
      todos = todos.filter((todo) => todo.id !== id);
      if (old) notify(old.plannedDate);
    },
    rolloverIncompleteTodos: async () => [],
    subscribeTodos: (date, listener) => {
      const callback = (changedDate: string) => {
        if (changedDate === date) void Promise.resolve(todos.filter((todo) => todo.plannedDate === date)).then(listener);
      };
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    listSuggestedTopics: async () => topics,
    getTopicContext: async (topicId) => {
      const topic = topics.find((value) => value.id === topicId);
      return topic ? { topic, latestSession: null, latestHandoff: null, currentWorkspace: null } : null;
    },
    getDailyProjection: async () => null,
  };
}

function createE2eAuth(): AuthPort {
  return {
    getSession: async () => ({ userId: "e2e-user", email: "e2e@example.test" }),
    onAuthStateChange: () => () => undefined,
    enroll: async () => ({ userId: "e2e-user", email: "e2e@example.test" }),
    clearDeviceCredential: async () => undefined,
  };
}

function renderBootstrapError(
  root: HTMLElement,
  kind: BootstrapErrorKind,
  provider: string | undefined,
) {
  root.innerHTML = "";
  const message = document.createElement("main");
  message.className = "flowcontext-app";
  const detail = getBootstrapErrorDetail(kind, provider);
  const title = kind === "configuration" ? "FlowContext 尚未配置" : "FlowContext 启动失败";
  message.innerHTML = `<section class="content-section"><h1>${title}</h1><p class="error-text">${detail}</p></section>`;
  root.appendChild(message);
}

function renderConfigurationError(root: HTMLElement, provider: string | undefined) {
  renderBootstrapError(root, "configuration", provider);
}

function renderRuntimeError(root: HTMLElement, provider: string | undefined) {
  renderBootstrapError(root, "runtime", provider);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("FlowContext root element is missing");
const root: HTMLElement = rootElement;

async function bootstrap() {
  if (window.location.hash === "#todo-timer") {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"), import("@tauri-apps/api/event"),
    ]);
    type ActiveTask = { title: string; revision: number };
    const timerRoot = createRoot(root);
    const showTask = (task: ActiveTask) => timerRoot.render(
      <TodoTimer key={task.revision} title={task.title} onClose={() => invoke("close_todo_timer")} />,
    );
    let receivedTask = false;
    await listen<ActiveTask>("flowcontext:todo-timer-task", ({ payload }) => {
      receivedTask = true;
      showTask(payload);
    });
    const task = await invoke<ActiveTask | null>("read_todo_timer_task");
    if (task && !receivedTask) showTask(task);
    return;
  }
  const provider = import.meta.env.VITE_FLOWCONTEXT_PROVIDER;
  let platform: Awaited<ReturnType<typeof createRuntimePlatform>>;
  try {
    platform = await createRuntimePlatform();
  } catch {
    renderRuntimeError(root, provider);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const expandedWeek = window.location.hash === "#todo-week";
  // Deterministic fixtures are available only from the development server
  // used by Playwright; a production bundle can never bypass the real
  // AuthGate. Real provider selection happens only after this E2E branch.
  const e2eMode = platform.mode === "web" && import.meta.env.DEV ? params.get("e2e") : null;
  if (e2eMode === "1" || e2eMode === "network-failure" || e2eMode === "desktop-density" || e2eMode === "calendar-coverage") {
    const today = platform.today();
    const seed: Todo[] = e2eMode === "desktop-density"
      ? [
        { id: "timed", title: "制作三分钟内口播脚本 Skill", plannedDate: today, plannedTime: "09:30", isCompleted: false, projectId: null, topicCardId: null },
        { id: "long", title: "这是一个用于验证紧凑桌面待办行省略行为的超长任务标题，不应挤压右侧操作按钮", plannedDate: today, plannedTime: null, isCompleted: false, projectId: null, topicCardId: null },
        { id: "untimed", title: "申请并落实 AI 资源", plannedDate: today, plannedTime: null, isCompleted: false, projectId: null, topicCardId: null },
        { id: "done-1", title: "刷新全部 Power BI 报表", plannedDate: today, plannedTime: null, isCompleted: true, projectId: null, topicCardId: null },
        { id: "done-2", title: "研究起标题 Skills", plannedDate: today, plannedTime: null, isCompleted: true, projectId: null, topicCardId: null },
        { id: "done-3", title: "排好今天的口播", plannedDate: today, plannedTime: null, isCompleted: true, projectId: null, topicCardId: null },
      ]
      : e2eMode === "network-failure"
      ? [{ id: "morning", title: "上午任务", plannedDate: today, plannedTime: "09:00", plannedEndTime: null, isCompleted: false, projectId: null, topicCardId: null }]
      : e2eMode === "calendar-coverage"
      ? [
        { title: "写结算说明", plannedTime: "09:30" },
        { title: "核对汇总", plannedTime: "09:45" },
        { title: "准备资料", plannedTime: null },
        { title: "提前出发", plannedTime: "06:59" },
        { title: "收尾", plannedTime: "23:00" },
        { title: "夜间备份", plannedTime: "23:01" },
        { title: "发送结算单", plannedTime: "07:00", plannedDate: "2026-08-06" },
        { title: "整理材料", plannedTime: "14:00", plannedEndTime: "17:00", plannedDate: "2026-08-04" },
        { title: "复核材料", plannedTime: "17:00", plannedEndTime: "18:00", plannedDate: "2026-08-04" },
      ].map((todo, index) => ({ id: `calendar-${index}`, plannedDate: "2026-08-05", isCompleted: false, projectId: null, topicCardId: null, ...todo }))
      : [];
    const topics: TopicCard[] = e2eMode === "desktop-density"
      ? [{ id: "density-topic", projectId: "flowcontext", title: "Handoff 云端绑定与写入", state: "open", currentState: "Handoff 原子写入已完成，等待 macOS 实机验收。", nextAction: "在 macOS 原生全屏应用中验证热区唤出。", openQuestions: [], lastActiveAt: "2026-08-04T12:00:00.000Z", focusRank: 1 }]
      : [];
    createRoot(root).render(
      <App
        mode={e2eMode === "desktop-density" ? "desktop" : platform.mode}
        repository={createMemoryRepository(seed, e2eMode === "network-failure", topics)}
        platform={platform}
        expandedWeek={expandedWeek}
        auth={createE2eAuth()}
      />,
    );
    return;
  }

  if (provider !== "self-hosted") {
    renderConfigurationError(root, provider);
    return;
  }

  const apiUrl = import.meta.env.VITE_FLOWCONTEXT_API_URL?.trim();
  if (!apiUrl) {
    renderConfigurationError(root, provider);
    return;
  }
  try {
    const storage = platform.sessionStorage;
    createRoot(root).render(
      <App
        mode={platform.mode}
        repository={new HttpFlowRepository({
          baseUrl: apiUrl,
          getAccessToken: () => storage.get(DEVICE_TOKEN_STORAGE_KEY),
          getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        })}
        platform={platform}
        expandedWeek={expandedWeek}
        auth={createHttpAuth({
          baseUrl: apiUrl,
          storage,
          deviceId: platform.deviceId,
          devicePlatform: platform.devicePlatform,
        })}
        authApiUrl={apiUrl}
      />,
    );
  } catch {
    renderRuntimeError(root, provider);
  }
}

void bootstrap();
