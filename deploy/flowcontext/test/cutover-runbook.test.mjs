import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runbook = new URL("../../../docs/self-hosted-cutover-runbook.md", import.meta.url);

test("cutover runbook requires auditable backup, import verification, device checks, and rollback", async () => {
  const document = await readFile(runbook, "utf8");

  for (const required of [
    "SHA-256",
    "manifest.json",
    "verify --input",
    "macOS",
    "Windows",
    "回滚",
  ]) {
    assert.match(document, new RegExp(required));
  }
});

test("cutover runbook protects the existing edge, credentials, and controlled device enrollment", async () => {
  const document = await readFile(runbook, "utf8");

  for (const required of [
    "只读预检",
    "80/443",
    "Nginx",
    "隔离",
    "非 root",
    "第二次独立登录",
    "服务器.*\.env",
    "写入冻结",
    "0600",
    "空目标",
    "每台设备",
    "预绑定",
    "Supabase",
    "凭据",
    "令牌",
    "注册码",
  ]) {
    assert.match(document, new RegExp(required));
  }
});

test("cutover runbook marks planned actions separately from verified evidence and never claims completion", async () => {
  const document = await readFile(runbook, "utf8");

  assert.match(document, /计划步骤/);
  assert.match(document, /已验证证据/);
  assert.match(document, /不得.*断言.*完成/);
  assert.match(document, /状态：计划步骤，尚未执行/);
});

test("cutover runbook uses the approved isolated Nginx TLS boundary instead of Caddy public ports", async () => {
  const document = await readFile(runbook, "utf8");

  assert.match(document, /flowcontext\.zkabi\.cn/);
  assert.match(document, /Nginx.*TLS/);
  assert.match(document, /loopback/);
  assert.match(document, /Caddy.*不得.*80\/443/);
  assert.match(document, /Task7\.5/);
});

test("cutover runbook requires edge, persistence, log-redaction, and desktop-regression evidence", async () => {
  const document = await readFile(runbook, "utf8");

  for (const required of [
    "HTTP.*80.*443",
    "5432",
    "API.*不可达",
    "容器重启",
    "数据.*持久",
    "凭据.*持久",
    "日志.*脱敏",
    "Codex.*deep link",
    "原生浮窗",
  ]) {
    assert.match(document, new RegExp(required));
  }
});
