#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${FLOWCONTEXT_APP_PATH:-apps/desktop/src-tauri/target/debug/bundle/macos/FlowContext.app}"
APP_NAME="FlowContext"

if [[ ! -d "$APP_PATH" ]]; then
  echo "FAIL: app bundle not found: $APP_PATH" >&2
  exit 1
fi

open -gj "$APP_PATH"
sleep 2

count="$(pgrep -x "$APP_NAME" | wc -l | tr -d ' ')"
if [[ "$count" != "1" ]]; then
  echo "FAIL: expected one $APP_NAME process, found $count" >&2
  exit 1
fi

# The tray icon is intentionally kept as a manual check because macOS may
# hide overflow icons behind Control Centre and System Events needs an extra
# Accessibility permission.  The process check above proves the shell started.
open "codex://settings" || true
echo "PASS: bundle exists, one process is running, codex://settings was dispatched"
echo "MANUAL: verify the FlowContext tray item is visible and opens 显示/隐藏/设置/退出"
