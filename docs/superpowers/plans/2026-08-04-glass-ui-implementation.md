# FlowContext 毛玻璃 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以参考图为基准重构 FlowContext Web/Tauri 界面，同时保持所有现有数据与交互行为。

**Architecture:** 在全局 token 中定义玻璃材质、文字、圆角、阴影、焦点与动效语义；布局 CSS 为桌面与 Web 两种 shell 提供分层外壳。React 组件仅作语义和图标替换，业务 hooks、仓库调用和页面装配顺序保持不变。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、Playwright、CSS。

## Global Constraints

- 不修改 `apps/desktop/src-tauri/`、`tauri.conf.json` 或任何原生窗口代码。
- 不引入第三方图标依赖；使用内联 SVG。
- 页面顺序固定为 Header、Today To-do、建议继续、Daily Lens、Codex Reports、Project Groups。
- 不硬编码任务、时间、数量或 Topic 示例数据。
- 保留 `<details>` disclosure 语义、Codex 深链、Web 日期选择和 Desktop 固定当天规则。

---

### Task 1: 锁定可访问的视觉结构

**Files:**
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/src/features/todos/TodoSection.test.tsx`
- Create: `apps/web/src/ui/icons.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/features/todos/TodoSection.tsx`
- Modify: `apps/web/src/features/todos/TodoForm.tsx`
- Modify: `apps/web/src/features/todos/TodoRow.tsx`
- Modify: `apps/web/src/features/topics/TopicCard.tsx`

**Interfaces:**
- Consumes: existing `TodoCreate`, `TodoPatch`, `TopicLinkInput`, repository hooks and platform port.
- Produces: `PencilIcon`, `TrashIcon`, `PlusIcon`, `ClockIcon`, `CheckIcon`, `ArrowRightIcon`, `SyncIcon`, `SunIcon`; all rendered controls retain accessible names.

- [x] **Step 1: Write failing tests**

Add expectations that the main heading is “今天，继续推进”, the To-do section heading is “今日待办”, the structural order remains To-do before 建议继续, and the rendered To-do row exposes accessible 编辑/删除 buttons.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @flowcontext/web test -- src/app/App.test.tsx src/features/todos/TodoSection.test.tsx`

Expected: failure because the new Chinese To-do heading and icon-button accessible rendering are absent.

- [x] **Step 3: Add the minimal semantic implementation**

Create the inline SVG icon exports. Use `aria-hidden="true"` on SVG paths and retain meaningful `aria-label` on controls. Update App and Todo/Topic components to render the required labels and icons without changing callbacks, state mutations, disabled logic, or data queries.

- [x] **Step 4: Run focused tests and verify they pass**

Run: `pnpm --filter @flowcontext/web test -- src/app/App.test.tsx src/features/todos/TodoSection.test.tsx`

Expected: both test files pass.

### Task 2: Implement the glass token and layout system

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/layout.css`
- Modify: `apps/web/src/features/todos/todo.module.css`

**Interfaces:**
- Consumes: existing semantic classes from App, todos, topics and daily disclosures.
- Produces: desktop glass shell, web fallback canvas, card/control layers, responsive form and row layout, focus states and reduced-motion-safe transitions.

- [x] **Step 1: Implement token mapping and fallback**

Define `--glass-shell`, `--glass-panel`, `--glass-panel-strong`, `--glass-control`, `--glass-border`, `--glass-hairline`, `--radius-shell`, `--radius-card`, `--radius-control`, `--shadow-shell`, `--shadow-card`, `--focus-ring`, and `--transition-fast`. Preserve existing token names by mapping `--surface`, `--surface-subtle`, `--border`, `--accent` and `--danger` to the new system.

- [x] **Step 2: Implement shell and component styling**

Give `.flowcontext-app[data-mode="desktop"]` a 10px inset, rounded translucent shell, shadow, and backdrop filter, with an opaque fallback inside `@supports not`. Give Web mode a static pale blue canvas. Style the header and cards, then style To-do controls and rows to match the specified 22px checkbox and 38px icon action targets. Preserve `details/summary`, error, empty and disabled states.

- [x] **Step 3: Run typecheck and focused tests**

Run: `pnpm --filter @flowcontext/web typecheck && pnpm --filter @flowcontext/web test -- src/app/App.test.tsx src/features/todos/TodoSection.test.tsx src/features/topics/SuggestedTopics.test.tsx`

Expected: exit code 0.

### Task 3: Verify runtime appearance and regressions

**Files:**
- Verify only: `apps/web/e2e/today-flow.spec.ts`, `apps/web/e2e/network-failure.spec.ts`

**Interfaces:**
- Consumes: built Web app and E2E fixture routes.
- Produces: visual screenshot evidence and regression verification; no product code changes unless an observed defect requires a new test-first fix.

- [x] **Step 1: Build the Web app**

Run: `pnpm --filter @flowcontext/web build`

Expected: Vite build exits 0.

- [x] **Step 2: Run all Web unit tests and E2E tests**

Run: `pnpm --filter @flowcontext/web test && pnpm --filter @flowcontext/web e2e`

Expected: exit code 0 with no failed test.

- [x] **Step 3: Inspect the visual fixture**

Run the Vite dev server with `?e2e=1`, open the page with Playwright/available browser tooling at 420px width, and inspect that the glass hierarchy does not clip controls or collapse the required section order.

- [x] **Step 4: Record verified outcome in project context**

Update the linked Obsidian project `status.md` only with completed checks and evidence, preserving existing entries and tight Markdown formatting.
