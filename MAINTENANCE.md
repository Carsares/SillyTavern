> 历史文档：当前默认入口已转向 Conversation v1。本文件描述旧系统，不作为新系统运行说明。请参阅 [新架构](docs/conversation/ARCHITECTURE.md)、[新运维说明](docs/conversation/OPERATIONS.md)和[验证状态](docs/conversation/IMPLEMENTATION.md)。

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
| `src/endpoints/chats.js` | 聊天完整性 revision、per-save 修订；`POST /search-all`（跨角色/群聊搜索）与抽出的共用函数 `listUserChatFiles` |
| `src/endpoints/horde.js` | 阻塞 swipe 完成 |
| `src/endpoints/settings.js` | settings 快照；`delete-snapshot`、`prune-snapshots`；快照轮转前缀改为带尾下划线的 `settings_<handle>_` |
| `src/endpoints/data-maid.js` | 追加 `usage`、`duplicate-greetings`、`duplicate-greetings/resolve`；`delete` 支持 `detailed` 逐项结果；文件身份校验抽到 `src/file-identity.js` |
| `src/endpoints/backups.js` | 追加 `POST /chat/stats`（备份统计与按天数预览） |
| `src/endpoints/translate.js` | 失败返回短 JSON 错误体、成功返回纯文本；不再记录原文与译文；Lingva 失败返回 500；Yandex 分块拼回不再插入逗号 |
| `src/util.js` | `removeOldBackups` 按精确系列匹配（`isBackupOfSeries`） |
| `src/` 新增文件 | `data-usage.js`、`data-maid-duplicate-greetings.js`、`chat-backup-stats.js`、`settings-snapshots.js`、`file-identity.js`（由上面的 endpoint 调用） |
| `public/script.js` | legacy bridge（`modernBridge` 协议、`isModernBridgeMode` 特化、生成链路桥接）；引擎串行队列、`integrity` 不一致时重开聊天、`summarize` / `reloadWorldInfo` 等动作、`reloadSettings` 的扩展设置白名单 |
| `public/scripts/extensions/memory/index.js` | bridge 模式下不注册扩展自带的自动摘要触发；新增导出 `summarizeForModernBridge`、`getSummaryBridgeBlocker`、`isSummaryDue`、`reapplyMemorySettings` |
| `public/scripts/world-info.js` | 新增导出 `invalidateWorldInfoCache`（引擎世界书缓存失效） |
| `public/scripts/*`（TTS/persona 等） | XSS 转义、voice map 等注入修复 |
| 安全加固系列 | 认证先于 body 解析、ZIP/下载限额、body parser 作用域、限流 |

> 台账随改动增补。生成会话期 settings 反写字段的审计表由 M2.2.1 追加到第 6 节。

## 3. 冻结面（不得随意改动的契约）

- **后端 API 契约**：`/api/...` 的 payload、响应、默认值、错误、存储语义保持兼容，除非显式更新契约。
- **legacy bridge 协议**：source 标识、action 名、消息字段、超时档位——协议契约化后（M2.1）以 `public/modern/core/bridge-protocol.js` 为单一来源，legacy 与 modern 双侧引用。改协议必须双侧同步 + headless e2e 契约测试护航。动作清单、串行规则、`integrity` 和 `summarize` 等的语义见 [MODERN_UI_ARCHITECTURE.md](MODERN_UI_ARCHITECTURE.md) 的 Hidden engine bridge 一节。
- **用户数据格式**：角色卡、聊天文件、worldbook、settings.json 的磁盘格式与上游兼容。数据迁移属后端启动/数据管理代码，不做前端兜底。

## 4. 月度巡检 SOP（目标 ≤ 半天）

每月执行一次，把实际耗时记入第 7 节，前两个月用于校准半天预算：

1. **上游安全巡检**：`git fetch upstream`，过一遍上游 `security`/`fix` 类 commit；仅对触及 `src/endpoints/`、`src/middleware/`、`src/*.js` 共享面的条目评估定点 cherry-pick（合入须过 CI 门禁）。前端与功能类更新一律不追。
2. **依赖安全**：`npm audit`，只吃安全补丁，不做大版本升级（ESLint/Jest/Node 锁版本）。
3. **北极星信号 1**：查 backend access log 中不带 `?modernBridge=1` 的 `/index.html` 请求——统计手动打开隐藏旧页的次数（目标：连续 30 天为 0）。
4. **provider 存活**：按需跑 external 巡检（`MODERN_EXTERNAL_E2E=1`）抽查远程资源 provider；坏了用 enabled 开关关掉，不修长尾。
5. **data 备份口径核查**：见第 5 节；存储占用、聊天备份和设置快照的数量可在「设置 → 数据维护」查看（见第 9 节）。
6. **CI flake**：处置门禁偶发 flake（计入本月耗时；连续 flake 的用例降级修复而非重试掩盖）。

> upstream remote 尚未配置（由 M2.5.1 执行 `git remote add upstream`，只 fetch 不 merge）。

## 5. data/ 备份口径

- 仓库内 `data/`（`.gitignore` 忽略）是唯一一份用户数据；chat backups 与 settings snapshot 都落在 `data/` **内部**，目录级损坏时同归于尽。
- **决策**：依赖机器级备份（Time Machine）作为主手段；月度巡检时额外 `rsync data/` 到仓库外一份作为二次保险。
- M4 的 raw settings 编辑器与日常写路径仍直接作用于这唯一一份数据——改高风险配置前手动触发一次 settings 快照。
- 数据维护页的隔离目录 `backups/quarantine-*` 同样在 `data/<用户>/backups/` 内，随该目录一起备份和一起损坏（见第 9 节）。在「数据维护」里做 Data Maid 清理、删快照、删聊天备份之前，先确认机器级备份可用或导出一次完整数据：这三类删除不可恢复。

## 6. 已知债务及不修理由

- **legacy bridge 单点**：生成链路依赖隐藏 iframe 加载完整旧引擎。**不摘除、不重写**（约 4.7 万行深度纠缠 DOM 的核心，单人不可维护）；路线是契约化 + 同步通道 + 失败可感知，把 bridge 做成可信管道。
- **全量 innerHTML 重渲染**：滚动/焦点靠散落补丁维持，是回归高发区。M5 起用定点 DOM 更新逐步替代，BG2 收敛为单一原语；个人数据规模下不构成紧急瓶颈。
- **35 个 remote-resources provider**：站点解析是消耗品，坏了用 enabled 开关关（M6.2a）。**不建自动健康监控，不治理硬编码第三方凭据，不补 fixture 全覆盖。**
- **失养测试**：`tests/frontend/Macro*` 假设旧版 `/` 直达，与 302 重定向不兼容——只从执行入口排除（M1.2），不删文件。
- **新增聊天/设置功能的已知限制**：集中记在第 12 节（连接档案跳过项、摘要来源、估算不含草稿、翻译只做显示等），修复前先读那里。
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

## 9. 数据维护页（设置 → 数据维护）运维说明

所有会删除或移动用户数据的分区走同一流程：先扫描并列出明细 → 勾选 → 点按钮只打开确认框 → 确认后才发请求。Data Maid 与重复会话的扫描结果带 token 和文件身份（设备、inode、大小、修改/变更时间），文件在扫描之后变了会被跳过并说明原因。页面在扫描 10 分钟后要求重新扫描；切到别的设置标签会让未完成的 Data Maid 报告作废。

| 分区 | 接口 | 做什么 | 是否可恢复 |
| --- | --- | --- | --- |
| 存储占用 | `POST /api/data-maid/usage` | 按目录统计大小和文件数；只做 `readdir`/`lstat`，不打开文件，不跟随符号链接；最多看 30 万个条目或 15 秒，超出的目录标为「下限」（`truncated`）；同一用户同时只跑一次扫描 | 只读 |
| 未引用文件清理 | `POST /api/data-maid/report` → `/delete`（`detailed: true`） | Data Maid 的 9 类报告：未引用的用户图片、聊天附件，没有角色卡的角色聊天、没有群组引用的群聊，三类多余缩略图，以及聊天备份、设置快照（后两类在本页有专门分区，这里不提供一键勾选）。删除时逐个再校验：路径在用户目录内、文件仍在、仍未被引用、文件身份未变，逐项返回 `deleted` / `skipped`（`outside`、`missing`、`referenced`、`changed`、`failed`、`unknown`）和释放的字节数 | **直接删除，不可恢复**；图片和整份聊天类用红色警告 |
| 重复的仅开场白会话 | `POST /api/data-maid/duplicate-greetings` → `/resolve` | 见 9.1 | 移到隔离目录，不删除 |
| 设置快照 | `POST /api/settings/delete-snapshot`、`/prune-snapshots` | 删单个，或按「保留最近 N 份」清理（N 为 1 到 10000 的整数）。清理默认只预览，只有 `dryRun` 明确为 `false` 才删；确认时只删预览里列出的那几份。最新一份不能删（返回 409）；文件名必须恰好是 `settings_<handle>_<YYYYMMDD-HHMMSS>.json`；与设置保存、恢复排同一条队列 | 不可恢复 |
| 聊天备份 | `POST /api/backups/chat/stats`、已有的 `/api/backups/chat/delete` | 统计备份数量、大小，按角色系列分组，并列出文件名不规范的备份。「早于 N 天」（1 到 3650）先预览，确认时重新统计一次，只删仍然满足条件、且你在预览里看过的文件，逐个调用 `chat/delete`。统计最多读 10 万个 `chat_*.jsonl`，预览最多列 2000 个文件名（超出标记 `namesTruncated`）；文件名不符合 `chat_<名>_<时间>.jsonl` 的只计入「未识别」，不会进入按天数清理 | 不可恢复 |
| 完整数据导出 | 已有的 `POST /api/users/backup` | 下载整个用户目录的 zip。`config.yaml` 里 `backups.allowFullDataBackup` 为 `false` 时服务器返回 403，页面会提示需要管理员开启 | 只读 |

### 9.1 重复的仅开场白会话与隔离目录

背景：Modern 在首次打开角色时自己建会话文件之前，隐藏的旧引擎也会另建一份只含开场白的会话，与 `Modern <时间>.jsonl` 并存。检测要求**全部**满足才列入报告：

- 文件名是旧版命名 `<角色名> - 2026-09-04@12h30m45s123ms.jsonl`，角色名等于角色卡上的名称，文件不超过 256 KB；
- 恰好 1 条消息，是角色消息（不是用户/系统消息，不是 Modern 写入的），内容等于卡上的某条开场白（允许 `{{char}}`、`{{user}}` 替换后的写法），候选（swipes）也都是卡上的开场白，没有附件或其他额外内容；
- `chat_metadata` 里没有用户数据（只允许引擎自己写的字段或空值）；
- 同目录有 `Modern <ISO 时间>.jsonl`，两者时间相差不超过 30 分钟，且该 Modern 会话至少有 2 条消息或以同一条开场白开头；
- 扫描上限：5000 个角色目录、2 万个旧版命名文件、30 秒，超出时报告标记 `truncated`。

如果它正是角色卡 `chat` 字段指向的会话，报告里单独标出：确认移动时页面先把卡的 `chat` 改指向那份 Modern 会话（`/api/characters/merge-attributes`），改失败的那一项不移动。服务器在移动前再校验一遍（身份、规则、卡不再指向它），不满足的跳过。

隔离目录与恢复：

- 位置：`<数据根>/<用户>/backups/quarantine-YYYYMMDD-HHMMSS/chats/<角色头像文件名（不含 .png）>/<会话文件>`；同一秒内重复创建时目录名追加 `-2`、`-3`。同卷用 `rename`，跨卷则复制、核对大小后再删源；目标已存在时拒绝覆盖。没有任何文件被移动时，本次建的空目录会自动清掉。
- 同目录的 `manifest.json`：`version`（当前为 1）、`createdAt`、`reason`（`duplicate-greeting-only-chats`）、`restore`（一句恢复说明）、`items[]`（每项含 `avatar`、`file`、`size`、`from`、`to`、`modern`、`mtimeMs`）。`from`、`to` 都是相对用户数据目录的路径。写 manifest 失败时接口返回 `manifestError`，文件仍已移动。
- 恢复：把 `to` 指向的文件移回 `from`。如果该会话曾是角色卡的当前会话，卡的 `chat` 已改指向 Modern 会话，移回文件**不会**把卡改回去。
- 页面没有「恢复」或「清空隔离目录」按钮；确认不再需要后手动删除 `quarantine-*` 目录。

### 9.2 备份轮转按精确系列匹配

此前聊天备份的轮转按前缀匹配：清理 `chat_alice_` 的旧备份时，会把 `chat_alice_2_<时间>.jsonl`（另一个角色的备份）一并算进去。现在 `removeOldBackups`（`src/util.js`）在不传 `limit` 时只认 `<前缀><YYYYMMDD-HHMMSS>.<扩展名>`，系列名恰好以同样文字开头的不再受影响；传了 `limit` 的是整族总量上限（`backups.chat.maxTotalBackups`，前缀 `chat_`），仍按前缀匹配。设置快照的前缀同样改为 `settings_<handle>_`，不再跨用户。已经被旧逻辑清掉的备份无法找回。每个系列保留数量由 `backups.common.numberOfBackups` 决定（默认 50）。

## 10. 新增功能的运维注意

- **「生成引擎未能同步」提示**：设置、聊天文件、角色或世界书已经保存成功，但通知隐藏引擎重载失败（引擎报错，或 30 秒内没有确认）。下一次生成可能仍用旧配置；再保存一次，或刷新页面让引擎重新加载。引擎侧排队的重载之后仍会执行。
- **翻译与隐私**：文本经本机后端转发给所选翻译服务。默认服务是 `google`（非官方公网接口，可能被限流或在部分网络下不可用）；`bing`、`lingva`、`yandex`、`deepl` 同样走公网，`libre`、`oneringtranslator`、`deeplx` 发往你自己配置的地址。每个服务第一次使用时页面要求确认一次，确认记录在浏览器 `localStorage` 的 `st-modern-translate-privacy-ack`，换服务要重新确认。后端 `/api/translate/*` 不再记录原文和译文，只记长度；上游返回错误时，会把截断到 300 字符的上游错误响应写进 `warn` 日志。API Key 与服务地址写入密钥库，不回显。
- **跨角色搜索**：`POST /api/chats/search-all` 默认 8 秒预算（上限 15 秒）、最多返回 50 个聊天（上限 200），6 个文件并发，按修改时间从新到旧。超时、客户端断开或达到上限时返回 `partial: true` 和 `partialReason`，页面显示「结果不完整」。关键词至少 2 个字符（含中日韩文字时 1 个字也行），最多 10 个词、200 个字符。页面显示「结果不完整」时，更旧的聊天可能没被扫描到，可改用「当前」范围在具体角色里再搜一次。
- **聊天摘要**：摘要写在消息的 `extra.memory`（已有摘要的消息优先，没有则倒数第二条），生成时多一次主模型调用。bridge 模式下摘要扩展自带的自动触发已关闭，何时摘要由 Modern 决定：每次回复成功后按设置判断，到点才请求引擎。摘要请求会占用引擎串行队列，期间不能发送，可以停止。
- **连接档案**：应用档案会保存设置、可能轮换密钥（`/api/secrets/rotate`，改变该来源当前启用的密钥，属于全局副作用）并通知引擎重载；生成中禁止切换。聊天输入框旁的「最近使用的模型」记在浏览器 `localStorage` 的 `st-modern-recent-models`（每个来源最多 5 个）。
- **聊天背景**：全局背景在 `settings.background`，聊天锁定在聊天头 `custom_background`；聊天专属上传图存在 `user/images/<角色名>/`，并登记在聊天头 `chat_backgrounds`。**不要**只放图片不登记：Data Maid 会把未登记的 `user/images` 文件当未引用图片。遮罩强度和开关存在 `localStorage`（`st-modern-chat-bg-dim`、`st-modern-chat-bg-enabled`）。

## 11. 新增测试怎么跑

先装依赖：`npm install` 和 `npm --prefix tests install`（CI 用 `npm ci`）。

- **Jest 单测**（`tests/*.test.js`，含 `modern-chat-completion-limits`、`modern-character-book`、`modern-chat-summary`、`modern-connection-profiles`、`modern-translation`、`modern-maintenance-actions`，以及后端的 `chat-search-all`、`data-maid-duplicate-greetings`、`data-maid-usage`、`data-maid-safety`、`backup-rotation`、`backup-stats`、`settings-snapshots`、`translate-endpoint`）：`npm run test:unit --prefix tests`。只跑一个文件：在 `tests/` 目录下执行 `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.json <文件名>`（命令取自 `tests/package.json` 的 `test:unit` 脚本）。
- **Playwright E2E**（`tests/modern-*.e2e.js`，新增 `modern-slots`、`modern-engine-sync`、`modern-chat-metadata`、`modern-chat-authors-note`、`modern-chat-background`、`modern-chat-summary`、`modern-chat-connection`、`modern-chat-global-search`、`modern-data-maintenance`、`modern-translation`）：在 `tests/` 目录执行 `npx playwright test --project=default --workers=1`，或在仓库根目录用 `./tests/node_modules/.bin/playwright test tests/modern-slots.e2e.js --config=tests/playwright.config.js`。**不要**在仓库根目录直接 `npx playwright`：根目录与 `tests/` 装的 Playwright 版本不同，会报 “two different versions of @playwright/test”。
- **多个运行同时跑**：每个运行用自己的端口和输出目录，否则会互相关掉模拟服务器：`PLAYWRIGHT_MOCK_PORT=8123 ./tests/node_modules/.bin/playwright test <文件> --config=tests/playwright.config.js --workers=2 --output=/tmp/<唯一目录>`。端口范围 1024 到 65535，8000（开发服务器）会被拒绝；非 8100 的端口把数据根移到 `tests/.e2e-data-<端口>/`，默认输出目录移到 `tests/test-results-<端口>/`（均已 gitignore）。
- **无界面引擎契约测试**：`tests/modern-bridge-headless.e2e.js` 用真实的旧版页面验证 bridge 协议（重载、串行、`integrity`、`summarize`、世界书缓存）。改 `public/script.js` 的 bridge 分发区、`core/bridge-protocol.js` 或摘要扩展时必须跑它。
- **桥接替身**：其余 E2E 用 `tests/modern-test-utils.js` 的 `mockBridgeFrame(page, { replies })` 替换隐藏 iframe，返回实时的 `{ action, payload }` 数组，用来断言页面发了什么、顺序如何；它不证明引擎侧行为。
- **真实后端和外部依赖**：`--project=real-backend`、`MODERN_EXTERNAL_E2E=1` 加 `--project=external`，不进 PR 门禁。
- 其余门禁：`git diff --check`、`npm run lint`、`npm run typecheck:modern`。

## 12. 新增功能的已知限制

- **连接档案只做精确匹配**：预设、代理、模型名对不上就跳过并写明原因，不像旧版那样模糊挑「最像的」。聊天补全档案可应用 API、预设、地址、模型、代理、停止字符串、回复前缀、提示词后处理和密钥；**文本补全的预设（采样参数）、指令/上下文模板、系统提示词、分词器、推理模板、正则预设**都列入「已跳过」，需要去 API 页或旧版配置。模型 id 按自由文本写入，不对照远端模型列表。
- **摘要来源**：默认来源 `extras` 需要 Extras 服务器，Modern 不连接它，所以自动摘要和「重新摘要」都不可用，直到把来源改成主模型（WebLLM 要求扩展和浏览器的 WebGPU 都可用）；页面只提示并提供一键切换，从不静默改。摘要字数阈值用旧版的 ASCII 单词计数，中文聊天基本只能靠「间隔」触发。
- **提示词用量与估算**：输入框旁的「上次发送 X / 预算 Y」读的是最近一次真实生成的分解，从没生成过时不显示；`estimatePrompt`（下一次提示词大小估算，以 `core/bridge-protocol.js` 为准）不含输入框里还没发送的草稿，也不含发送时才运行的扩展（如向量检索）；群聊和 AI Horde 不支持，必选提示词超出预算时只返回原因。预算 = 上下文长度 − 回复上限；依赖远端模型列表的来源，上下文上限只是参考值，旧版引擎载入设置时可能再收紧。
- **`reloadSettings` 的同步范围**：生成相关设置、世界书全局参数（扫描深度、预算、递归等）、全局启用的世界书（只保留引擎认识的名字）和角色附加世界书都会同步；世界书部分由 `applyModernBridgeWorldInfoSettings` 只赋值，不重放 `setWorldInfoSettings`（它每次调用都会叠加事件监听）。扩展设置只同步 `memory`、`translate`、`connectionManager`、`note` 四项。
- **内嵌世界书**：Modern 导入并关联后不会改写卡内的 `character_book`，导出的卡保留原始内容（旧版会用世界书重写）；结构不规范的卡会被后端校验拒绝。
- **开场白**：卡上空白的备用开场白会被丢弃（旧版保留为空白候选）；「载入备用开场白」只支持单人聊天；本地切换只在聊天只有一条开场白、有多个候选、未被标记 `tainted` 时生效，其余走引擎。
- **翻译只做显示**：不翻译用户输入，旧扩展的自动翻译模式在页面上只读，只提供「关闭自动翻译」。只有 AI 回复有翻译入口。公网翻译接口可能被限流或不可用。
- **推理模型参数未实现**：设置页「聊天工具」里的「推理解析」分区只是预留位，当前不显示。
- **聊天背景**：只接受 `backgrounds/` 与 `user/images/` 下的站内相对路径；动画背景（`gif`、`apng`、`mp4`）在系统开启「减少动态效果」时不显示；没有背景音乐或环境音播放器。
- **跨角色搜索**：不支持正则和整词匹配；结果最多 50 个聊天，每个聊天最多 3 条片段；达到时间或数量上限时只给部分结果。
- **数据维护**：隔离目录没有界面恢复入口，见 9.1；Data Maid 的图片和聊天类删除不可恢复；存储占用统计在条目或时间超限时只给下限。
