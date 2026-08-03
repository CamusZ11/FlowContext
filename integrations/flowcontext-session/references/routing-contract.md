# Session Routing Contract
## 输入
- 当前 cwd 与已确认的 Project 工作区映射
- Codex 技术 thread ID、设备 ID、开始时间
- 用户首条请求
## 输出
- 唯一 Project
- 唯一主 Topic Card
- 一个可幂等重试的 Session ID
## 决策顺序
1. cwd 精确映射优先；无映射时不猜测。
2. 一个高置信度匹配可创建或复用 Topic。
3. 多个候选或语义不确定只问一个问题。
4. Session 登记成功后才继续执行任务。
5. thread ID 已登记时返回原 Topic/Session，不重新绑定。
