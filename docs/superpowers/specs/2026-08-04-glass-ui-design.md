# FlowContext 毛玻璃 UI 设计
## 目标
把 FlowContext 的共享 Web/Tauri 界面重塑为参考图所示的冰蓝毛玻璃工作上下文面板，同时保持现有真实数据、排序、错误处理、Codex Deep Link 与桌面浮窗行为。
## 范围与边界
- 保留固定页面顺序：Header、Today To-do、建议继续、Daily Lens、Codex Reports、Project Groups。
- 仅修改 `apps/web` 内的组件与样式；不修改 Rust、Tauri 配置、NSPanel、热区、全屏 Space 或窗口层级文件。
- 不引入图标依赖；图标使用可访问的内联 SVG。
- 参考图中的任务、数量、时间和 Topic 均为视觉样例，所有显示继续取自真实仓库数据。
## 视觉方向
桌面端以透明窗口内 10px 边距的圆角玻璃外壳承载内容，目标尺寸为 420px，并在 360–560px 间适配。颜色以深海军蓝文字、雾蓝背景、半透明白色卡片和极浅高光边界组成；系统字体保证 macOS 与 Windows 一致性。页面中唯一强化交互是深色“添加”方按钮，其他操作为安静的玻璃图标按钮。
## 信息结构
Header 采用品牌、主标题“今天，继续推进”和同步状态的纵向层次；Web 日期选择器保留在品牌行附近，Desktop 继续隐藏。To-do 与建议继续是两张主玻璃卡；后续 Daily Lens、Codex Reports、Project Groups 保留原有 `<details>` 语义并以较轻的玻璃卡呈现。
## 交互与可访问性
保留 To-do 的新增、勾选回退、Enter 保存、Escape 取消和删除失败提示。编辑、删除、添加、同步和状态图标都有文本替代；按钮和输入使用可见的键盘焦点环；尊重既有禁用状态和错误状态。
## 验收
- UI 视觉 token、玻璃层次、图标按钮、响应式布局均由 CSS 与 React 渲染实现。
- To-do 与 Topic 既有单元测试、应用顺序测试和浏览器 E2E 均通过。
- `pnpm --filter @flowcontext/web typecheck`、测试、构建及 Playwright E2E 通过。
