import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop launches with its main panel visible", async () => {
  const config = JSON.parse(
    await readFile(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );

  assert.equal(config.app.windows[0].visible, true);
});
