---
name: generating-handoff
description: 在用户确认后生成不可变 FlowContext Handoff，并保护 Topic Card 的 done 状态。
---
# FlowContext Canonical Generating Handoff
本文件是 FlowContext 内 `generating-handoff` 的唯一规范源。用户级 Skill 安装只能指向本目录。
## 触发与语义
- “放一放”和“收工”是同一 Handoff 触发词，语义完全相同；两者都只开始交接草稿流程。
- 触发词本身不代表主题完成，不代表 Topic Card done，也不改变 Project 生命周期。
## 流程
1. 先确认本任务已经运行 `flowcontext-session`，并取得其保存的 Project、Topic Card 与 Session ID；没有唯一绑定时不得写入，必须先完成路由或向用户澄清。
2. 使用当前 Session 的绑定 Topic Card，整理已完成、当前状态、停止点、下一步、开放问题和需要用户确认的事实。
3. 展示 Handoff 草稿，等待用户明确确认或修正。未确认时不得调用写入命令。
4. 确认后将正文写入临时 JSON 文件，使用稳定的 `idempotencyKey` 调用 `persist-handoff.sh`；不得把正文放在命令参数或 shell history。JSON 必须含 `sessionId`、`topicCardId`、`content`、`idempotencyKey`，可含 `topicUpdate.currentState`、`topicUpdate.nextAction` 与 `topicUpdate.openQuestions`。
5. 云端通过单个原子写入校验 `Session -> Topic Card -> Project` 归属后，插入不可变 Handoff，并同步更新允许的 Topic 连续性字段；不得传入或修改 Project ID、Topic state、`latestHandoffId` 或 `lastActiveAt`，后两项由数据库维护。
6. 写入云数据库成功后只输出 Handoff ID、Topic/Session ID 和成功状态，不输出完整正文或 token。重试沿用同一个幂等标识。
7. Project 层事实必须另行展示 Obsidian 同步草稿，得到独立确认后才写回 Obsidian。
## done 保护
- 只有用户明确表达主题结束、完成或关闭时，才允许调用显式 Topic 完成 API。
- 生成 Handoff 不得标记 Topic Card done；暂停、收工、等待和写入失败都保持 Topic open。
- 缺少显式完成确认时，拒绝任何 `topic complete` 调用并继续保持 open。
## 失败处理
云端写入失败时保留聊天中已经确认的 Handoff 草稿，明确报告“云端未写入”，不伪造成功；用户重试时必须复用同一幂等 key。
