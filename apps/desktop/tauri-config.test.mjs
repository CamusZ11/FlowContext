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

test("reopening a running app restores its panel on the main thread", async () => {
  const startup = await readFile(new URL("./src-tauri/src/lib.rs", import.meta.url), "utf8");
  const singleInstance = startup.split("tauri_plugin_single_instance::init(")[1]?.split(".plugin(")[0];

  assert.match(singleInstance, /run_on_main_thread\(move \|\| \{[\s\S]*runtime::show_panel/);
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

test("app and tray quit share the timer archive exit path", async () => {
  const startup = await readFile(new URL("./src-tauri/src/lib.rs", import.meta.url), "utf8");
  const timer = await readFile(new URL("./src-tauri/src/todo_timer.rs", import.meta.url), "utf8");
  const tray = await readFile(new URL("./src-tauri/src/tray.rs", import.meta.url), "utf8");

  assert.match(startup, /\.menu\(tray::macos_quit_menu\)/);
  assert.match(tray, /accelerator\("CmdOrCtrl\+Q"\)/);
  assert.match(tray, /"quit" => app\.exit\(0\)/);
  assert.match(timer, /RunEvent::ExitRequested[\s\S]*api\.prevent_exit\(\)/);
  assert.match(timer, /destroy_timer\(&window, &state\)\.await\?;[\s\S]*\.exit\(code\)/);
});
