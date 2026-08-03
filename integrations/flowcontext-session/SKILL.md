---
name: flowcontext-session
description: 在 Codex 任务开始时把当前工作区路由到唯一 Project、Topic Card 与 Session。
---
# FlowContext Session Routing
本 Skill 是 FlowContext 内的规范源。它只登记云端连续性对象，不修改 Obsidian Project 原文。
## 任务开始流程
1. 读取当前任务的工作目录，并按 Project Context 的原始工作区映射解析一个 Project。找不到唯一 Project 时只提出一个澄清问题，不猜测归属。
2. 读取该 Project 的开放 Topic Cards。首条请求若高置信度属于一个新主题，可以创建一个新的 Topic Card，并在对用户的正常回复中说明已创建；高置信度的判断必须有请求标题、下一步或现有上下文依据。
3. 若同时匹配多个 Topic、无法判断是否为新主题，必须先询问用户，不创建 Topic，也不登记 Session。
4. 一条 Codex 任务只能登记一个主 Topic Card。旁支讨论只作为引用，不能偷偷重绑主 Topic；正式更换主题必须新建 Codex 任务。
5. 调用 `flowcontext session start --json <临时 JSON 文件>` 登记 Session，输入必须包含 `topicCardId`、Codex 技术 thread ID、设备 ID、工作区路径和开始时间。不要把 JSON 正文放在命令参数中。
6. 保存返回的 Topic Card ID 与 Session ID。当前 thread 再次触发本流程时，以 thread ID 幂等返回原绑定，不创建第二个 Session。
## 安全与边界
- Project 的目标、生命周期和长期上下文始终以 Obsidian 为事实源；Session Routing 只保存路由引用。
- 不把 token、密码、Handoff 正文或个人文件内容写入 Skill、日志或命令行参数。
- 不因“放一放”“收工”、暂停或生成 Handoff 而创建 done 状态；它们属于相同的 Handoff 草稿流程。
- 只有用户明确表达主题结束时，后续 Handoff Skill 才能调用 Topic 完成 API。
- 注册失败时报告失败和可重试动作，不伪造已绑定状态。
