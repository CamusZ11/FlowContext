import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows smoke uses the FlowContext mock-launcher handoff instead of dispatching Codex directly", async () => {
  const script = await readFile(new URL("./scripts/smoke-windows.ps1", import.meta.url), "utf8");
  assert.match(script, /FLOWCONTEXT_EXTERNAL_LAUNCHER = 'mock'/);
  assert.match(script, /--flowcontext-test-launch/);
  assert.match(script, /codex:\/\/threads\/mock-thread/);
  assert.match(script, /codex:\/\/new\?path=/);
  assert.match(script, /Assert-MockLauncherRoutes/);
  assert.doesNotMatch(script, /Start-Process\s+['"]codex:\/\//i);
});

test("Windows smoke cleans only the tested current-user process and installation", async () => {
  const script = await readFile(new URL("./scripts/smoke-windows.ps1", import.meta.url), "utf8");
  assert.match(script, /Get-FlowContextProcesses/);
  assert.match(script, /FlowContext\\flowcontext-desktop\.exe/);
  assert.match(script, /try \{/);
  assert.match(script, /\} finally \{/);
  assert.match(script, /Remove-ItemProperty -Path \$runKey -Name 'FlowContext'/);
});
