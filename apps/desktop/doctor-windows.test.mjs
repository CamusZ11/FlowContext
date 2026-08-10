import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows doctor resolves MSVC executables through the active PowerShell environment", async () => {
  const script = await readFile(new URL("./scripts/doctor-windows.ps1", import.meta.url), "utf8");

  assert.match(script, /Get-Command cl\.exe -ErrorAction Stop/);
  assert.match(script, /Get-Command link\.exe -ErrorAction Stop/);
  assert.doesNotMatch(script, /where\.exe cl\.exe/);
  assert.doesNotMatch(script, /where\.exe link\.exe/);
});
