# FlowContext 桌面验收清单

## 自动化

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [ ] `pnpm --filter @flowcontext/desktop tauri build`
- [ ] macOS `bash apps/desktop/scripts/smoke-macos.sh`
- [ ] Windows `./apps/desktop/scripts/smoke-windows.ps1`

## macOS 实机

- [ ] 右侧外部边缘 2 个物理像素停留 150 ms 后唤出。
- [ ] 鼠标离开浮窗后在下一次 25 ms 采样立即隐藏。
- [ ] 双屏接缝不触发；断开选中屏后回退主屏。
- [ ] 420 逻辑像素默认宽度可调整到 360–560，并在重启后保持。
- [ ] 托盘显示/隐藏/设置/退出可用。
- [ ] `CommandOrControl+Shift+Space` 可在热区失效时显示/隐藏。
- [ ] 点击 Codex 链接只打开 Codex Desktop，不自动发送 prompt。
- [ ] 设备凭据不出现在浏览器 `localStorage`。

## Windows 实机

- [ ] 安装包可启动且双击第二次复用单实例。
- [ ] 100% 与 150% 缩放下热区位置和浮窗宽度正确。
- [ ] 负坐标、多显示器和全屏应用覆盖行为正确。
- [ ] 托盘、快捷键、开机启动与 `codex://settings` 均可用。

实机证据分别记录在 `docs/verification/desktop-macos.md` 与
`docs/verification/desktop-windows.md`；Windows 文档必须由真实 Windows
Codex 执行后填写，不得以 Mac 交叉编译结果替代。
