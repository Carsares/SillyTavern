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
- **生成会话期 settings 反写字段清单 + 白名单**（M2.2.1 审计）：

  **核心结论（修正前置假设）**：`Generate()`（`public/script.js:4583`）与 `generateGroupWrapper()`（`public/scripts/group-chats.js:974`）的生成主链路**本身不调用 `saveSettingsDebounced/saveSettings`**，不写 `/api/settings/save`。生成结果只落到**聊天文件**：单聊 `saveChatConditional()`→`/api/chats/save`（`script.js:5865`、`10006`），群聊 `saveGroupChat()`→`/api/chats/group/save`（`group-chats.js:662`）。因此"生成会反写全量 settings"这一假设**在生成调用内部并不成立**——真正的回滚风险是：legacy iframe 内**任何**来源的 `saveSettingsDebounced` 都会经 `saveSettings()`（`script.js:8561`）把 iframe 持有的**陈旧全量 payload**（`script.js:8579-8604` 的 24 个字段）整包 POST 回后端，debounce 把多次触发合并成一次全量覆盖，静默盖掉 modern 侧的保存。

  **生成期唯一触碰 settings 字段的机制**是 `TempResponseLength`（`script.js:4446`）：生成前把 `amount_gen`（非 openai）或 `oai_settings.openai_max_tokens`（openai）**临时**改成本次请求的 responseLength（`save()` 4459-4470），生成数据组装完/事件回调时 `restore()` 还原（4477-4493）。这是**瞬态、会还原**的，且 `saveSettings()` 头部主动拦截：`TempResponseLength.isCustomized()` 为真时**重新排队而不落盘**（8569-8577），所以临时值按设计**不会被持久化**。`max_context` 生成期只读（用局部 `this_max_context` 副本），从不写回。

  **全量 payload 字段逐项分类（生成期视角）**：

  | 字段 | 来源/触发点（函数+行号） | 生成期行为 | M2.2.2 判定 |
  | --- | --- | --- | --- |
  | `firstRun` | `getSettings` 8547（bridge 下强制 false） | 只读 | 阻止 |
  | `accountStorage` | `accountStorage.getState()` 8581 | 只读 | 阻止 |
  | `currentVersion` | 常量 8582 | 只读 | 阻止 |
  | `username`(name1) | persona 改名 `setUserName` 8392 | 只读 | 阻止 |
  | `active_character` | 选角/改名 7751 等 | 只读 | 阻止 |
  | `active_group` | 群切换 | 只读 | 阻止 |
  | `user_avatar` | persona 选择 | 只读 | 阻止 |
  | `amount_gen` | slider 12361 / preset 8646；**生成期 `TempResponseLength` 8464 临时改** | **瞬态，restore 还原，save 已 guard 排除** | 阻止 |
  | `max_context` | `#max_context` slider / preset | 只读（局部副本 `this_max_context`） | 阻止 |
  | `main_api` | `#main_api` change 12327 | 只读 | 阻止 |
  | `world_info_settings` | WI 设置面板 | 只读 | 阻止 |
  | `textgenerationwebui_settings` | textgen 面板（`textgen-settings.js` 各 handler） | 只读 | 阻止 |
  | `swipes` | `#swipes-checkbox` 11718 | 只读 | 阻止 |
  | `horde_settings` | horde 面板；生成期 `adjustHordeGenerationParams` 用局部 `adjustedParams` | 只读 | 阻止 |
  | `power_user` | power-user 面板 11377 等 | 只读 | 阻止 |
  | `extension_settings` | 各扩展面板 | 核心生成链路只读（扩展监听见下方存疑项） | 阻止 |
  | `tags`/`tag_map` | tag 管理 | 只读 | 阻止 |
  | `nai_settings` | NAI 面板（`nai-settings.js`） | 只读 | 阻止 |
  | `kai_settings` | KAI 面板（`kai-settings.js`） | 只读 | 阻止 |
  | `oai_settings` | OAI 面板；`openai_max_tokens` **生成期 `TempResponseLength` 4462 临时改**；`*_model` 自动选 `openai.js:2338` 属连接/拉模型列表阶段 | `openai_max_tokens` 瞬态已 guard；其余只读 | 阻止 |
  | `background` | 背景选择 | 只读 | 阻止 |
  | `proxies`/`selected_proxy` | proxy preset 面板 | 只读 | 阻止 |

  **给 M2.2.2 的白名单集合**：**空集 ∅**。生成主链路不需要向 `/api/settings/save` 写回任何字段——所有 payload 字段在生成期要么只读、要么是 `TempResponseLength` 的瞬态值（已被 `saveSettings()` 的 guard 排除）。因此 bridge 模式下可对 legacy iframe 的 `/api/settings/save` **整体短路**（拦在 `saveSettings()` 网络请求处，或直接让 `saveSettingsDebounced` 在 `isModernBridgeMode` 下 no-op）。**必须保持放行**的是**聊天写路径** `/api/chats/save` 与 `/api/chats/group/save`（不同端点，承载生成结果，短路会丢消息）——这是与 settings 短路的关键区分线。

  **置信度与存疑项（留人工确认）**：
  - 核心结论（生成主链路不写 settings、白名单为空）置信度高，基于通读 `Generate`（4583-5900，内部仅 `saveChatConditional`）、`saveSettings` payload（8579-8604）、`TempResponseLength`（4446-4515）、`saveSettings` guard（8569-8577）、群聊 `generateGroupWrapper`（仅 `saveGroupChat/editGroup`，无 settings save）。
  - **存疑（超出 script.js 审计边界）**：第三方**扩展**若在 `GENERATION_ENDED`（3829）/`MESSAGE_RECEIVED` 等生成事件监听里自行调 `saveSettingsDebounced`（多为写 `extension_settings`），在 legacy iframe 内仍会触发全量回写。M2.2.2 的短路若落在 `saveSettings()`/`saveSettingsDebounced` 统一入口即可覆盖这条；若只针对生成主链路做白名单则覆盖不到。建议短路做在**统一入口**而非按调用点白名单。

## 7. 巡检记录

| 日期 | 上游安全 | npm audit | 北极星信号1 | provider | 实际耗时 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-18（首次） | 无需 cherry-pick | 43（C1/H13/M29） | 基线未建 | 未跑 | 随实施完成 | 见下方说明 |

**2026-07-18 首次巡检说明**：

- **upstream remote 已配置**：`upstream` → SillyTavern 官方（push 已禁用，只 fetch）。`upstream/release` 仍 1.18.0、仅比 fork 基点 `51ad27fb8` 多 1 个 commit；开发在 `upstream/staging`（相对基点 +44 commit，version 仍 1.18.0）。
- **上游安全面**：staging 上触及 `src/` 的安全/修复类仅 1 条 —— `fd582be5c Add rate limit to account reset (#5603)`。经核对，fork 的 `src/endpoints/users-public.js` **已有** login/recover 双限流（`loginLimiter`/`recoverLimiter`），该条**已被覆盖，无需 cherry-pick**。其余 43 条为功能/前端类，按「前端与功能类一律不追」不跟。
- **值得关注（不 action，仅记录）**：upstream 有 `feat/secret-data-encrypt`（对应本手册第 6 节 secrets 明文债务，但按 antiGoals 不做加密，仅备案）、`fix/nested-emphasis-markdown`（渲染，与本 fork 刻意的纯文本强调策略不冲突，不追）。
- **npm audit**：43（critical 1 / high 13 / moderate 29），多为传递依赖。按锁版本原则**不做 `audit fix --force` 破坏性升级**；单机不公网 listen 威胁模型下风险有限。**待跟进**：单独核对 critical/high 是否在实际运行路径可达，可达且有非破坏补丁的才吃。
- **北极星信号1**：access log 基线尚未建立（本次实施自身产生 e2e server 请求，不计入）；下次巡检起正式统计不带 `?modernBridge=1` 的 `/index.html` 请求。

## 8. 不做清单（antiGoals）

以 [ROADMAP.md](ROADMAP.md) 第 6 节为准，摘要：不做移动端适配、不做 legacy P4/P5 删除、不摘 bridge/重写引擎、不做上游全量 rebase、不引入前端框架/构建链、不为 remote-resources 建平台化系统、不做多用户/公网安全强化、不移植 slash commands/扩展运行时、不把 real-backend/external e2e 塞进 PR 门禁、不做资源级深链接、不追覆盖率数字、不大规模升级工具链、不引入发布流程、不做未显形性能优化。
