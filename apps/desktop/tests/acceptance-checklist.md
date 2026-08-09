# FlowContext 桌面验收清单

## 自动化

- [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [x] `pnpm --filter @flowcontext/desktop tauri build`
- [ ] macOS `bash apps/desktop/scripts/smoke-macos.sh`
- [ ] Windows `./apps/desktop/scripts/smoke-windows.ps1`

## macOS 实机

- [x] 右侧外部边缘 2 个物理像素停留 150 ms 后唤出。
- [x] 指针进入面板后离开时隐藏；启动、显示或坐标漂移不自动隐藏。
- [ ] 双屏接缝不触发；断开选中屏后回退主屏。
- [ ] 420 逻辑像素默认宽度可调整到 360–560，并在重启后保持。
- [x] 菜单栏仅注册一个 FlowContext 托盘图标。
- [ ] 托盘显示/隐藏/设置/退出可用。
- [x] `CommandOrControl+Shift+Space` 可在原生全屏应用中显示浮层且不抢焦点。
- [x] 原生全屏应用中右侧热区可显示浮层。
- [ ] 点击 Codex 链接只打开 Codex Desktop，不自动发送 prompt。
- [ ] 设备凭据不出现在浏览器 `localStorage`。

## Windows 实机

- [ ] 安装包可启动且双击第二次复用单实例。
- [ ] 100% 与 150% 缩放下热区位置和浮窗宽度正确。
- [ ] 负坐标、多显示器和全屏应用覆盖行为正确。
- [ ] 托盘、快捷键、开机启动与 `codex://settings` 均可用。

Windows 证据必须由真实 Windows 设备填写，不得以 Mac 交叉编译结果替代。
