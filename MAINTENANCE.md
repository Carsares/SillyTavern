# 维护手册（MAINTENANCE）

> 本文件是这个 fork 长期存活的运维护栏：把"明文不做"的决策、冻结面、巡检节奏、已知债务文字化，防止未来的自己（或 AI 助手）重新掉进反目标。配合 [ROADMAP.md](ROADMAP.md) 使用——ROADMAP 定方向，本文件定边界与例行。

## 1. 冻结基线

- **上游基点**：SillyTavern 1.18.0（上游 commit `51ad27fb8`，2026-05-03）。`package.json` version 保持 `1.18.0`。
- **fork 主线**：`master` 单线开发 + 关键节点打 tag。当前锚点 tag：`v1.18.0-mw.1`（路线图实施前的稳定基线）。此后每个里程碑收尾打 tag（`v1.18.0-mw.2` …）作为回退锚点。不引入正式发布流程/CHANGELOG/发布分支。
- **默认界面**：`/modern/`（见 [MODERN_UI_ARCHITECTURE.md](MODERN_UI_ARCHITECTURE.md)）。旧版软下线（隐藏入口 `?modernBridge=1`，不删文件）。

## 2. 已改共享文件台账

fork 对上游共享后端/前端文件做了散布式改动，是上游同步冲突的来源。定点 cherry-pick 上游安全修复时，优先核对这些文件：

| 文件 | 改动主题 |
| --- | --- |
| `src/server-main.js` | modern 入口重定向、bridge 参数放行、中间件顺序 |
| `src/endpoints/characters.js` | 角色写失败暴露、完整性、引用迁移 |
| `src/endpoints/chats.js` | 聊天完整性 revision、per-save 修订 |
| `src/endpoints/horde.js` | 阻塞 swipe 完成 |
| `src/endpoints/settings.js` | settings 快照 |
| `public/script.js` | legacy bridge（`modernBridge` 协议、`isModernBridgeMode` 特化、生成链路桥接） |
| `public/scripts/*`（TTS/persona 等） | XSS 转义、voice map 等注入修复 |
| 安全加固系列 | 认证先于 body 解析、ZIP/下载限额、body parser 作用域、限流 |

> 台账随改动增补。生成会话期 settings 反写字段的审计表由 M2.2.1 追加到第 6 节。

## 3. 冻结面（不得随意改动的契约）

- **后端 API 契约**：`/api/...` 的 payload、响应、默认值、错误、存储语义保持兼容，除非显式更新契约。
- **legacy bridge 协议**：source 标识、action 名、消息字段、超时档位——协议契约化后（M2.1）以 `public/modern/core/bridge-protocol.js` 为单一来源，legacy 与 modern 双侧引用。改协议必须双侧同步 + headless e2e 契约测试护航。
- **用户数据格式**：角色卡、聊天文件、worldbook、settings.json 的磁盘格式与上游兼容。数据迁移属后端启动/数据管理代码，不做前端兜底。

## 4. 月度巡检 SOP（目标 ≤ 半天）

每月执行一次，把实际耗时记入第 7 节，前两个月用于校准半天预算：

1. **上游安全巡检**：`git fetch upstream`，过一遍上游 `security`/`fix` 类 commit；仅对触及 `src/endpoints/`、`src/middleware/`、`src/*.js` 共享面的条目评估定点 cherry-pick（合入须过 CI 门禁）。前端与功能类更新一律不追。
2. **依赖安全**：`npm audit`，只吃安全补丁，不做大版本升级（ESLint/Jest/Node 锁版本）。
3. **北极星信号 1**：查 backend access log 中不带 `?modernBridge=1` 的 `/index.html` 请求——统计手动打开隐藏旧页的次数（目标：连续 30 天为 0）。
4. **provider 存活**：按需跑 external 巡检（`MODERN_EXTERNAL_E2E=1`）抽查远程资源 provider；坏了用 enabled 开关关掉，不修长尾。
5. **data 备份口径核查**：见第 5 节。
6. **CI flake**：处置门禁偶发 flake（计入本月耗时；连续 flake 的用例降级修复而非重试掩盖）。

> upstream remote 尚未配置（由 M2.5.1 执行 `git remote add upstream`，只 fetch 不 merge）。

## 5. data/ 备份口径

- 仓库内 `data/`（`.gitignore` 忽略）是唯一一份用户数据；chat backups 与 settings snapshot 都落在 `data/` **内部**，目录级损坏时同归于尽。
- **决策**：依赖机器级备份（Time Machine）作为主手段；月度巡检时额外 `rsync data/` 到仓库外一份作为二次保险。
- M4 的 raw settings 编辑器与日常写路径仍直接作用于这唯一一份数据——改高风险配置前手动触发一次 settings 快照。

## 6. 已知债务及不修理由

- **legacy bridge 单点**：生成链路依赖隐藏 iframe 加载完整旧引擎。**不摘除、不重写**（约 4.7 万行深度纠缠 DOM 的核心，单人不可维护）；路线是契约化 + 同步通道 + 失败可感知，把 bridge 做成可信管道。
- **全量 innerHTML 重渲染**：滚动/焦点靠散落补丁维持，是回归高发区。M5 起用定点 DOM 更新逐步替代，BG2 收敛为单一原语；个人数据规模下不构成紧急瓶颈。
- **35 个 remote-resources provider**：站点解析是消耗品，坏了用 enabled 开关关（M6.2a）。**不建自动健康监控，不治理硬编码第三方凭据，不补 fixture 全覆盖。**
- **失养测试**：`tests/frontend/Macro*` 假设旧版 `/` 直达，与 302 重定向不兼容——只从执行入口排除（M1.2），不删文件。
- **生成会话期 settings 反写字段清单 + 白名单**：（M2.2.1 追加）

## 7. 巡检记录

| 日期 | 上游安全 | npm audit | 北极星信号1 | provider | 实际耗时 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| （待 M2.5.1 首次巡检） | | | | | | |

## 8. 不做清单（antiGoals）

以 [ROADMAP.md](ROADMAP.md) 第 6 节为准，摘要：不做移动端适配、不做 legacy P4/P5 删除、不摘 bridge/重写引擎、不做上游全量 rebase、不引入前端框架/构建链、不为 remote-resources 建平台化系统、不做多用户/公网安全强化、不移植 slash commands/扩展运行时、不把 real-backend/external e2e 塞进 PR 门禁、不做资源级深链接、不追覆盖率数字、不大规模升级工具链、不引入发布流程、不做未显形性能优化。
