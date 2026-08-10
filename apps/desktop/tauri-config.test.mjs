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

test("desktop uses only the manual FlowContext tray icon", async () => {
  const config = JSON.parse(
    await readFile(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const traySource = await readFile(
    new URL("./src-tauri/src/tray.rs", import.meta.url),
    "utf8",
  );

  assert.equal(config.app.trayIcon, undefined);
  assert.match(traySource, /TrayIconBuilder::with_id\("flowcontext"\)/);
});

test("Windows release overlay starts hidden with a current-user NSIS installer", async () => {
  const config = JSON.parse(
    await readFile(new URL("./src-tauri/tauri.windows.conf.json", import.meta.url), "utf8"),
  );

  assert.equal(config.app.windows[0].visible, false);
  assert.equal(config.app.windows[0].focus, false);
  assert.equal(config.app.windows[0].skipTaskbar, true);
  assert.equal(config.app.windows[0].decorations, false);
  assert.equal(config.app.windows[0].maximizable, false);
  assert.deepEqual(config.bundle.targets, ["nsis"]);
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(config.bundle.windows.webviewInstallMode.type, "offlineInstaller");
});

test("Windows CI uses the pinned MSVC toolchain and uploads redacted smoke evidence", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/windows-desktop.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /toolchain: 1\.88\.0/);
  assert.match(workflow, /x86_64-pc-windows-msvc/);
  assert.match(workflow, /ci-mock-launcher/);
  assert.match(workflow, /artifacts-smoke\.redacted\.log/);
});
