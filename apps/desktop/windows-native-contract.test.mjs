import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Windows window contract uses rcWork and an atomic passive SetWindowPos", async () => {
  const native = await source("./src-tauri/src/windows_window.rs");
  const geometry = await source("./src-tauri/src/display_geometry.rs");

  assert.match(native, /SetWindowPos\(/);
  assert.match(native, /HWND_TOPMOST/);
  assert.match(native, /SWP_NOACTIVATE/);
  assert.match(native, /SWP_SHOWWINDOW/);
  assert.match(native, /MONITORINFOEXW/);
  assert.match(native, /stable_id_for_bounds/);
  assert.match(native, /rcWork/);
  assert.doesNotMatch(native, /SetWindowLong(?:Ptr)?W?\([^)]*WS_EX_NOACTIVATE/s);
  assert.match(geometry, /work_bounds/);
  assert.match(geometry, /logical_width\.max\(1\.0\) \* self\.scale_factor/);
});

test("runtime delegates all native window work through the platform contract", async () => {
  const runtime = await source("./src-tauri/src/runtime.rs");
  const controller = await source("./src-tauri/src/window_controller.rs");
  const contract = await source("./src-tauri/src/platform_window.rs");

  assert.doesNotMatch(runtime, /macos_window::/);
  assert.match(runtime, /selected_display/);
  assert.match(runtime, /show_panel_interactive/);
  assert.match(controller, /ShowIntent::Passive/);
  assert.match(controller, /place_and_show/);
  assert.match(contract, /enum ShowIntent/);
});

test("settings, launcher and tray retain their Windows safety boundaries", async () => {
  const settings = await source("./src-tauri/src/settings.rs");
  const launcher = await source("./src-tauri/src/native_commands.rs");
  const tray = await source("./src-tauri/src/tray.rs");
  const diagnostics = await source("./src-tauri/src/diagnostics.rs");

  assert.match(settings, /apply_settings_transaction/);
  assert.match(settings, /pub fn install_shortcut/);
  assert.match(settings, /runtime\.reset_hot_zone\(\)/);
  assert.match(settings, /apply_shortcut\(&previous\.shortcut\)/);
  assert.match(launcher, /trait ExternalLauncher/);
  assert.match(launcher, /ci-mock-launcher/);
  assert.match(launcher, /url\.path\(\) == "\/"/);
  assert.match(tray, /show_panel_interactive/);
  assert.match(tray, /TrayIconBuilder::with_id\("flowcontext"\)/);
  assert.match(diagnostics, /pub fn get_diagnostics/);
  assert.match(diagnostics, /redact_monitor_id/);
  assert.match(diagnostics, /prohibited sensitive field/);
});

test("Rust toolchain pin stays aligned with the desktop MSRV", async () => {
  const toolchain = await source("../../rust-toolchain.toml");
  const manifest = await source("./src-tauri/Cargo.toml");
  assert.match(toolchain, /channel = "1\.88\.0"/);
  assert.match(toolchain, /x86_64-pc-windows-msvc/);
  assert.match(manifest, /rust-version = "1\.88"/);
});
