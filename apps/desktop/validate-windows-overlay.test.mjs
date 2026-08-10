import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("physical Windows overlay validation never claims an automated visual pass", async () => {
  const script = await readFile(new URL("./scripts/validate-windows-overlay.ps1", import.meta.url), "utf8");
  assert.match(script, /automatic_result=not_applicable/);
  assert.match(script, /2 physical pixels/);
  assert.match(script, /foreground application does not change/);
  assert.match(script, /shared monitor seam/);
  assert.match(script, /prohibited sensitive field/);
});
