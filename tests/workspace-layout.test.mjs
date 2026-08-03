import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("workspace declares required package roots", async () => {
  const yaml = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.match(yaml, /apps\/\*/);
  assert.match(yaml, /packages\/\*/);
  assert.match(yaml, /tools\/\*/);
});
