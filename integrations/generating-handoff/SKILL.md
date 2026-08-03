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
1. 使用当前 Session 的绑定 Topic Card，整理已完成、当前状态、停止点、下一步、开放问题和需要用户确认的事实。
2. 展示 Handoff 草稿，等待用户明确确认或修正。未确认时不得调用写入命令。
3. 确认后将正文写入临时 JSON 文件，使用稳定的 `idempotencyKey` 调用 `persist-handoff.sh`；不得把正文放在命令参数或 shell history。
4. 写入云数据库成功后只输出 Handoff ID、Topic/Session ID 和成功状态，不输出完整正文或 token。重试沿用同一个幂等标识。
5. 可以更新 Topic Card 的 current state、next action、open questions、latest handoff 和 last active at 等安全字段；不得通过 Handoff 改 Project 事实。
6. Project 层事实必须另行展示 Obsidian 同步草稿，得到独立确认后才写回 Obsidian。
## done 保护
- 只有用户明确表达主题结束、完成或关闭时，才允许调用显式 Topic 完成 API。
- 生成 Handoff 不得标记 Topic Card done；暂停、收工、等待和写入失败都保持 Topic open。
- 缺少显式完成确认时，拒绝任何 `topic complete` 调用并继续保持 open。
## 失败处理
云端写入失败时保留聊天中已经确认的 Handoff 草稿，明确报告“云端未写入”，不伪造成功；用户重试时必须复用同一幂等 key。
