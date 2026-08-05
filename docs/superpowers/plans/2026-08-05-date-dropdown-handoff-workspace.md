# Date Dropdown and Handoff Workspace Binding Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** Provide a seven-day visual date dropdown and make confirmed Handoffs atomically bind the originating device workspace so Continuity links are actionable.
**Architecture:** Date UI remains a pure Web state component driven by `selectedDate`. `flowcontext-session` persists an immutable Session platform; the Edge API reads device, platform, and workspace only from that authenticated Session and passes it into a new database RPC that creates the Handoff, updates Topic continuity, and upserts the device/project workspace in one transaction.
**Tech Stack:** React 19, TanStack Query, TypeScript/Vitest/Playwright, Supabase Postgres/PLpgSQL, Deno Edge API.
## Global Constraints
- Date list is exactly selected date ±3 days, labels `MM / DD 周X`, selected blue outline, outside/Escape/select closes.
- Browser URL/popstate and desktop in-memory date behavior remain unchanged.
- Handoff workspace path comes only from the server-validated Session; never accept it from Handoff JSON.
- Session platform is written only at session start as `macos` or `windows`; legacy persisted Sessions retain a nullable unknown platform and Handoff never accepts a platform field.
- Handoff, Topic update and workspace upsert are one owner-scoped transaction; no client-side fallback writes.
- No change to Topic done semantics, no arbitrary path picker, no sleep/wake files.
---
### Task 1: Persist Session platform and atomically bind Handoff workspace
**Files:** Create migration through `supabase migration new session_platform_and_handoff_workspace`; Modify `supabase/tests/core_schema.test.sql`, `supabase/tests/rls.test.sql`, `packages/domain/src/types.ts`, `schemas.ts`, `integrations/flowcontext-session/*` and their tests.
**Produces:** `create_handoff_and_update_topic` returns existing/new Handoff while atomically upserting `device_workspaces` from the owned Session.
- [ ] **Step 1: Write failing tests** for a Session requiring immutable `platform`, platform propagation from `flowcontext-session`, and a successful Handoff creating `(owner_id, session.device_id, topic.project_id)` workspace with `session.platform` and `session.workspace_path`; assert retry idempotency and mismatched owner/session full rollback.
- [ ] **Step 2: Verify RED** with `supabase test db --local supabase/tests/core_schema.test.sql supabase/tests/rls.test.sql`; expected missing workspace binding assertions.
- [ ] **Step 3: Create migration using** `supabase migration new session_platform_and_handoff_workspace`; add nullable, checked Session platform for legacy-read compatibility (new Session API writes are non-null), then replace the RPC so it loads the owned session/topic/project, rejects an unknown legacy platform before any write, inserts Handoff/update Topic, then:
```sql
insert into public.device_workspaces (owner_id, device_id, platform, project_id, workspace_path)
values (v_owner_id, v_session.device_id, v_session.platform, v_project_id, v_session.workspace_path)
on conflict (owner_id, device_id, project_id)
do update set workspace_path = excluded.workspace_path, platform = excluded.platform, updated_at = now();
```
Use Session platform derived from its device context or an explicit validated server-side mapping; reject unknown platform before any write.
- [ ] **Step 4: Verify GREEN** with the same pgTAP command; also verify migration list and security advisor when tooling is available.
- [ ] **Step 5: Commit** `git add supabase/migrations supabase/tests && git commit -m "feat: bind device workspace with handoff"`.
### Task 2: Edge Handoff contract and automatic current mapping
**Files:** Modify `supabase/functions/flowcontext-api/repository.ts`, `repository.test.ts`, `router.ts`, `router.test.ts`, `integrations/generating-handoff/SKILL.md`.
**Consumes:** Task 1 RPC. **Produces:** Edge Handoff endpoint has no client workspace input yet returns a successful Handoff only after server-side workspace binding.
- [ ] **Step 1: Write failing Deno tests** asserting `POST /v1/handoffs` causes repository RPC workspace binding, rejects a Session that cannot resolve its device/project context, and never accepts `workspacePath` from the JSON body.
- [ ] **Step 2: Run RED** `deno test --allow-env --allow-net supabase/functions/flowcontext-api/router.test.ts supabase/functions/flowcontext-api/repository.test.ts`.
- [ ] **Step 3: Implement minimal adapter changes** so `createHandoff` calls the new atomic RPC only; update Skill step 5 to state the automatic device/project workspace binding and its session-only source.
- [ ] **Step 4: Run GREEN** with the same command and relevant workspace tests.
- [ ] **Step 5: Commit** `git add supabase/functions integrations/generating-handoff && git commit -m "feat: bind workspace when persisting handoff"`.
### Task 3: Seven-day date dropdown
**Files:** Modify `apps/web/src/features/calendar/DateSelector.tsx`, `DateSelector.test.tsx`, `apps/web/src/features/todos/todo.css`; add `dateDropdown.ts` and test if date arithmetic needs isolation.
**Produces:** `DateSelector` exposes a deterministic 7-day list and popover open/close behavior.
- [ ] **Step 1: Write failing component tests** for seven ISO dates centered on selected value, exact Chinese weekday labels, selected row, click-to-select/close, Escape/outside close, and trigger keyboard accessibility.
- [ ] **Step 2: Run RED** `pnpm --filter @flowcontext/web test -- DateSelector.test.tsx`.
- [ ] **Step 3: Implement** local-calendar date helpers (no `toISOString()`), a `Popover` state, and rows:
```tsx
const dates = surroundingLocalDates(value, 3);
<div role="listbox" aria-label="选择日期">{dates.map(date => <button role="option" aria-selected={date === value} />)}</div>
```
Keep native input as non-tabbable fallback; close on document pointerdown outside and Escape.
- [ ] **Step 4: Add CSS** absolute card-local popover, max-height scroll, selected 1px blue outline, `ui-monospace` digits, no desktop overflow.
- [ ] **Step 5: Verify GREEN** with component tests, `pnpm --filter @flowcontext/web typecheck`, and Playwright density test; commit `feat: add visual date dropdown`.
### Task 4: Continuity loading and actionable-state UX
**Files:** Modify `apps/web/src/features/topics/SuggestedTopics.tsx`, `TopicCard.tsx`, their tests and topic CSS.
**Consumes:** existing `getTopicContext`. **Produces:** no misleading final grey button while context is unresolved, explanatory missing-workspace state.
- [ ] **Step 1: Write failing tests** for loading context showing `正在准备继续…`, resolved live Session enabling “打开当前任务”, resolved Handoff without workspace showing `下次 Handoff 将自动配置此设备`, and complete context calling `platform.openExternal`.
- [ ] **Step 2: Run RED** `pnpm --filter @flowcontext/web test -- SuggestedTopics.test.tsx`.
- [ ] **Step 3: Implement** explicit `contextQuery.isPending` state; retain disabled protection for missing workspace and no Handoff, but render the exact reason rather than an unexplained disabled control.
- [ ] **Step 4: Verify GREEN** with topic tests and `pnpm --filter @flowcontext/web typecheck`; commit `fix: explain unavailable continuity links`.
### Task 5: Verification, current backfill, and release
**Files:** Modify Obsidian `status.md` after evidence; no source changes unless tests expose a defect.
- [ ] **Step 1: Run** `pnpm verify`, Edge Deno tests, Web build, and `pnpm --filter @flowcontext/web e2e`.
- [ ] **Step 2: Apply the new migration to the approved remote Supabase project, then run owner-scoped SQL checks for function signature, SECURITY INVOKER, and the current FlowContext device/project mapping.**
- [ ] **Step 3: Backfill only the current FlowContext mapping** `/Users/camus/Documents/FlowContext` through the same owner/device/project safe path; verify “继续此主题” opens a Codex link.
- [ ] **Step 4: Build/install only from the clean feature worktree and record Package/Runtime/UI evidence separately.**
- [ ] **Step 5: Update project status, run Context audit, and commit only in-scope files.**
