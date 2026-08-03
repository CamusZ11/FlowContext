import { createRoot } from "react-dom/client";
import type { FlowRepository } from "@flowcontext/data";
import {
  HttpFlowRepository,
  SupabaseFlowRepository,
} from "@flowcontext/data";
import type { Todo, TodoCreate, TodoPatch } from "@flowcontext/domain";
import { App } from "./app/App";
import {
  createHttpAuth,
  createSupabaseAuth,
  type AuthPort,
} from "./features/auth/useAuth";
import { createRuntimePlatform } from "./platform/tauriPlatform";
import { createConfiguredSupabaseClient } from "./supabaseClientFactory";
import { getBootstrapErrorDetail, type BootstrapErrorKind } from "./bootstrapMessages";
import "./styles/tokens.css";
import "./styles/layout.css";

function createMemoryRepository(seed: Todo[] = [], rejectUpdates = false): FlowRepository {
  let nextId = 1;
  let todos = [...seed];
  const listeners = new Set<(date: string) => void>();
  const notify = (date: string) => listeners.forEach((listener) => listener(date));
  return {
    listTodos: async (date) => todos.filter((todo) => todo.plannedDate === date),
    createTodo: async (input: TodoCreate) => {
      const todo: Todo = { ...input, id: `e2e-${nextId++}` };
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
    subscribeTodos: (date, listener) => {
      const callback = (changedDate: string) => {
        if (changedDate === date) void Promise.resolve(todos.filter((todo) => todo.plannedDate === date)).then(listener);
      };
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    listSuggestedTopics: async () => [],
    getTopicContext: async () => null,
    getDailyProjection: async () => null,
  };
}

function createE2eAuth(): AuthPort {
  return {
    getSession: async () => ({ userId: "e2e-user", email: "e2e@example.test" }),
    onAuthStateChange: () => () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
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
  const provider = import.meta.env.VITE_FLOWCONTEXT_PROVIDER;
  let platform: Awaited<ReturnType<typeof createRuntimePlatform>>;
  try {
    platform = await createRuntimePlatform();
  } catch {
    renderRuntimeError(root, provider);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  // Deterministic fixtures are available only from the development server
  // used by Playwright; a production bundle can never bypass the real
  // AuthGate. Real provider selection happens only after this E2E branch.
  const e2eMode = platform.mode === "web" && import.meta.env.DEV ? params.get("e2e") : null;
  if (e2eMode === "1" || e2eMode === "network-failure") {
    const today = platform.today();
    const seed: Todo[] = e2eMode === "network-failure"
      ? [{ id: "morning", title: "上午任务", plannedDate: today, plannedTime: "09:00", isCompleted: false, projectId: null, topicCardId: null }]
      : [];
    createRoot(root).render(
      <App
        mode={platform.mode}
        repository={createMemoryRepository(seed, e2eMode === "network-failure")}
        platform={platform}
        auth={createE2eAuth()}
      />,
    );
    return;
  }

  if (provider === "self-hosted") {
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
            getAccessToken: () => storage.get("auth-token"),
          })}
          platform={platform}
          auth={createHttpAuth({ baseUrl: apiUrl, storage })}
        />,
      );
    } catch {
      renderRuntimeError(root, provider);
    }
    return;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    renderConfigurationError(root, provider);
    return;
  }

  try {
    const client = createConfiguredSupabaseClient(import.meta.env, platform.sessionStorage);
    createRoot(root).render(
      <App
        mode={platform.mode}
        repository={new SupabaseFlowRepository(client)}
        platform={platform}
        auth={createSupabaseAuth(client)}
      />,
    );
  } catch {
    renderRuntimeError(root, provider);
  }
}

void bootstrap();
