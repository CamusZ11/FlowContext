import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop window is created visible and setup snaps it to the right edge", async () => {
  const config = JSON.parse(
    await readFile(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const startup = await readFile(new URL("./src-tauri/src/lib.rs", import.meta.url), "utf8");

  // A window created hidden never reaches the WindowServer onscreen list on
  // macOS Accessory apps (verified 2026-08-07): window.show() later only
  // updates Tauri's own bookkeeping. Create it visible, then let setup snap
  // it to the selected monitor's right edge.
  assert.equal(config.app.windows[0].visible, true);
  assert.match(startup, /runtime::show_panel\(window\.clone\(\), settings\)\?;/);
});

test("macOS overlay uses native front ordering after Tauri shows the window", async () => {
  const nativeWindow = await readFile(
    new URL("./src-tauri/src/macos_window.rs", import.meta.url),
    "utf8",
  );

  assert.match(
    nativeWindow,
    /window\.show\(\).*?native\.orderFrontRegardless\(\)/s,
  );
});
