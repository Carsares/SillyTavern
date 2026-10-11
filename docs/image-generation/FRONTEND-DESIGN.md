# 会话内图片生成 · 前端改造方案（P1 + P2）

> 状态：方案稿，未实现。日期 2026-10-12，基于 HEAD `6e1641216`（设置中心重构 `b4ba46b78` 和图片生成后端 `7154f9354` 都已合入）。
> 配套文档：界面原型 `output/image-generation-mockup.html`，后端设计与实现 `docs/image-generation/BACKEND-DESIGN.md`。
> 文中「静态确认」指读过当前代码；「推断」指没有运行验证。

## 1. 结论与原型的差异

原型里的交互基本可以照做，但有六处要按当前代码调整。前四处会改变用户看到的行为，需要确认（第 9 节）。

| 编号 | 原型 | 调整为 | 原因（静态确认） |
| --- | --- | --- | --- |
| C1 | 独立的「API 页」加「文本模型 / 图片模型」切换 | 切换放进设置中心「模型连接」标签页内 | `b4ba46b78` 删除了 `api` 路由，`api` 现在是 `settings/connection` 的别名（`core/constants.js:30-33`） |
| C2 | 「保存图片模型」按钮 | 去掉，改成改完即存，与设置中心其他字段一致 | 设置中心统一在 change 事件时保存，e2e 断言页面上没有保存按钮（`tests/modern-api.e2e.js:202`） |
| C3 | 右侧「配置诊断」栏 | 改成表单下方的一张诊断卡 | 重构后「模型连接」页没有右侧栏（`api-diagnostics.js` 已删除） |
| C4 | 一次生成多张时，在同一版本里网格展示 | 每张图算一个版本，单图显示，用 ‹ i/N › 切换 | 与旧版生图扩展的 `extra.media` + `media_index` 存法一致，旧页面也能显示；不必另造「版本组」结构 |
| C5 | 原型没有涉及 | 最后一条是图片消息时，「继续」「重生成」不可用 | 旧引擎的「重生成」会删掉最后一条非用户消息，系统消息也照删（`public/script.js:4730-4736`），也就是会删掉图片；「继续」会把文字续写进图片消息 |
| C6 | 生成期间切换会话就不插入 | 仍插入发起生成的那个会话 | 图片属于原会话，丢掉等于白花钱；写入前如果该会话不在缓存里，先读取（参照 `updateModernChatMetadata`，`actions/chat-context.js:662-667`） |

## 2. 关键技术决定

| 编号 | 决定 | 理由 |
| --- | --- | --- |
| F1 | 图片生成期间复用 `state.engine.generating`，并新增 `state.engine.activity = 'image'` 区分来源 | 「生图期间不能发文本」是已确认的规则。复用这个标记后，现有的禁用逻辑全部自动生效：发送、继续、重生成、连接切换、消息编辑删除、Agent 开关、会话元数据写入（共约 15 处，见第 10 节）。Agent 已经有同样的先例（`actions/chat-agent.js:112-116`）。`activity` 用来让输入框显示「图片生成中」，并让「停止」去调 `/cancel`。 |
| F2 | 写图片消息走 `actionRegistry.chatContextActions.updateModernChatAndSync` | 它会排队写聊天文件，并通知旧引擎重新读取。F1 保证写入时没有文本生成在跑，避开 ROADMAP 记录的保存冲突。 |
| F3 | 图片消息沿用旧版生图扩展的格式 | `{ is_system: true, mes: '', extra: { media: [...], media_display: 'gallery', media_index, inline_image: false } }`，每个 media 项是一个版本。旧页面能正常显示，Data Maid 认得 `url`（`src/endpoints/data-maid.js:189-227`）。 |
| F4 | 勾选消息按身份 `send_date + name + is_user` 记，不按下标 | 消息列表只渲染最后 N 条，加载更早消息后下标会变；现有的 `findQueuedMessageIndex` 就是这样定位消息的（`actions/chat-messages.js:31-39`）。 |
| F5 | 图片提示词框包在 `data-preserve-inputs` 里 | 未读轮询每 5 秒可能整页重渲染（`app.js:332-380`）。不包的话，正在输入的提示词会丢焦点。 |
| F6 | 生成请求自己加 6 分钟超时；超时或断网后查 `GET /requests/:id`，不重新提交 | `apiFetch` 没有默认超时（`core/api-client.js:85-100`）。后端在浏览器断开后会继续生成并保留结果（后端 D5）。 |
| F7 | 设置中心的图片字段不能放在 `data-api-connection-form` 里面 | 否则它们的报错会挡住文本连接的「测试连接」，还会被套上文本表单的回车保存和提示刷新逻辑（`actions/api-autosave.js:541-544`）。 |

## 3. 设置中心「模型连接」→「图片模型」

### 3.1 界面

- 在 `components/api.js` 的 `renderConnectionTab()`（`:41-68`）顶部加分段切换「文本模型 / 图片模型」，状态存为 `state.settingsConnectionView`，用 localStorage 记住。文本模型那一侧保持现状。
- 图片模型那一侧由新组件 `components/settings-image-model.js` 渲染。它放在 `data-preserve-inputs` 里，外层容器是 `data-image-model-form`（不是 `data-api-connection-form`）。内容依次是：
  1. 当前配置摘要。
  2. 连接：供应商、地址、模型，外加常用模型按钮。
  3. 默认参数：由 `/capabilities` 返回的可用参数决定，不支持的字段置灰并写明原因。
  4. 密钥：复用 `renderSecretField`（`components/api-fields.js:21-33`），并沿用翻译密钥「已保存（打码值）+ 清除」的做法（`settings-tool-translate.js:55-90`）。
  5. 诊断卡：供应商是否支持、密钥是否已保存、可用参数，以及最近一次「检查配置」和「试生成」的结果。
  6. P2：「从消息生成提示词」设置，包括模板、默认勾选条数（3）和是否附带角色外貌。
- 顶部按钮：「检查配置」调用 `/capabilities`，不计费；「试生成一张」需要点两次确认，用固定提示词调用 `/generate`，`characterName` 传 `图片模型测试`。

### 3.2 保存

- 每个字段在 change 时保存：

  ```js
  settingsAutosave.commit({ changes: [[['extension_settings', 'imageGeneration', field], value]], label, syncEngine: false })
  ```

  `syncEngine: false` 是因为旧引擎不读这个键，不必重新加载（`actions/settings-autosave.js:253`）。保存失败时恢复输入框原值。
- 校验和取值放进纯函数 `resolveImageModelField(field, rawValue, settings)`，不碰 DOM，Jest 的 node 环境可以直接测。
- 改了供应商、模型或地址之后，重新调用 `/capabilities`。结果按 `provider|model|baseUrl` 缓存在 `state.imageModelSettings.capabilities`。
- 密钥：`settingsAutosave.commitSecret({ key: 'api_key_image_generation', value, label: 'image-generation modern', description: '图片模型 API Key' })`。P1 的 `secretId` 留空，后端读当前激活的条目（`src/endpoints/image-generation.js:278-279`），新写入的密钥会自动成为激活条目（`secrets.js:209-228`），所以 `commitSecret` 不用改。清除密钥走 `/api/secrets/delete`。
- 供应商选项、尺寸、比例、质量、风格的候选值放在新文件 `core/image-generation-options.js`，按供应商和模型规则列出，再用 `/capabilities` 的参数列表过滤。选项表里没有的值仍允许手填。

## 4. 聊天页

### 4.1 输入框（`components/chat-composer.js`）

- 元信息行目前是 `连接标签插槽 + 用量标签`（`:40`）。改成在最前面加一个插槽 `chatImageModeToggle`，渲染「文本 / 图片」切换，并登记到 `core/test-flags.js` 的插槽列表里（`:23-33`），以便测试时能关掉。图片模式下，连接标签插槽改为渲染图片模型标签，点开是配置摘要和「去设置中心修改」。
- 图片模式下，输入框主体交给新组件 `components/chat-image-composer.js` 渲染：「手动输入 / 从消息生成」分段、步骤条、勾选摘要、提示词框、参数标签、「生成图片」「清空」。元信息行保留。
- 这需要修改 `chat-composer.js`，而 `MODERN_UI_ARCHITECTURE.md:173` 要求新功能不要改这个文件。改动只有一个插槽加一处分支，在文档里登记为例外。
- 「继续」「重生成」在最后一条是图片消息时不可用（C5），按钮上提示「最后一条是图片消息」。
- `state.engine.activity === 'image'` 时，状态行显示「图片生成中…」，「停止」改为调用 `/cancel`。需要在 `actions/chat-generation.js` 的 `stopModernGeneration`（`:776`）里加一个分支，写法同它对 Agent 的处理。
- Agent 模式下整个输入框会被换掉（`components/chat-thread.js:100-107`），图片切换自然随之消失，无需额外处理。

### 4.2 消息列表

- **勾选模式**：在 `renderMessage`（`components/chat-message.js:101-174`）里加一个可选参数 `renderSelection(message, index)`，注入方式与翻译功能相同（`:39-40, 141, 167`）。复选框只出现在普通文本消息上；图片消息和其他系统消息变淡、不能勾选。
- **顶部提示条**放在 `.message-list` 内的第一个位置，用 sticky 固定。不能放在 `.message-list-frame` 的第一个位置，因为背景插槽插在那里，`tests/modern-slots.e2e.js:210-212` 还断言列表是那个容器的第一个子元素。
- **生成中卡片**仿照流式回复气泡（`chat-message.js:84-99`），只在 `job.cacheKey` 等于当前会话时显示。空会话现在只显示空状态（`chat-thread.js:105`），要改成有任务时也渲染列表。
- **图片消息卡片**由新组件 `components/chat-image-message.js` 渲染：两个标签（图片、不进入上下文）、单图、‹ i/N › 切换、折叠的提示词、参数行，以及重新生成、编辑提示词、复制、下载、删除几个操作。
  - 删除复用现有的两步删除流程（`actions/chat-messages.js:106-143`），删掉整条消息。
  - `chat-message-content.js` 遇到图片消息时，不再渲染默认的媒体网格。
- **大图浮层**：新组件 `components/chat-image-lightbox.js`，样式参照 `styles/overlays.css:128-150`。
- **滚动**：现有的贴底跟随会在图片加载时处理（`routes/chat-scroll.js:297-301`），不需要额外处理。

### 4.3 生成流程（新文件 `actions/chat-image-generation.js`）

1. 校验：已配置图片模型、`engine.generating` 为假、提示词不为空。
2. 加锁：
   - `engine.generating = true`，`engine.activity = 'image'`。
   - 记下任务 `{ requestId: crypto.randomUUID(), cacheKey, entity, chatId, groupMode, kind: 'new' | 'version', targetIdentity, prompt, params, startedAt }`。
   - 把 `requestId` 和目标会话写进 sessionStorage，刷新页面后还能找回。
3. 请求：
   - `apiFetch('/api/image-generation/generate', { body, signal })`，6 分钟后自动中止。
   - 收到 202 时，每 3 秒查一次 `/requests/:id`。
   - 超时或网络失败时也去查；查到 404 才显示黄色「结果未知」卡片。
4. 写入：调用 `updateModernChatAndSync(entity, chatId, mutate)`。
   - 会话不在缓存里时，先用 loader 读取。
   - `kind: 'new'` 时，追加一条图片消息，`send_date` 用新的 ISO 时间；多张图依次作为多个版本。
   - `kind: 'version'` 时，按 `targetIdentity` 找到原消息，把新图追加到 `extra.media`，并把 `media_index` 指向最后一张。
   - 写入完成后调用 `refreshSelectedChatList`。
5. 失败：
   - 解析 `JSON.parse(error.body)`，得到 `{ error, message, detail, outcome }`。
   - `outcome` 为 `not-charged` 时显示红卡；为 `unknown` 或 `charged` 时显示黄卡。
   - 写聊天文件失败（比如会话已被改名或删除）时提示「图片已生成并保存在 `<path>`，但没能写入会话」，带打开图片的链接。
6. 解锁：无论成败都在 `finally` 里清掉 `engine.generating` 和 `activity`，然后 `render()`。

纯函数集中放在 `core/image-message.js`，方便单测：`isImageMessage`、`buildImageMessage`、`appendImageVersion`、`getCurrentImageVersion`、`messageIdentity`、`describeImageFailure`。

### 4.4 状态（`core/state.js`）

新增两个功能骨架，与现有约定一致（`:110-114`）：

- `chatImageGeneration: {}`，通过 `core/chat-image-state.js` 的 `ensureChatImageState(state)` 懒创建。按 cacheKey 存一个 Map，每项包含 `{ mode, sub, autoStep, selected: Set<identity>, prompt, negative, params, promptFrom }`，另有全局唯一的 `job`（后端限制每个用户同时只跑一单）。
- `imageModelSettings: {}`，存设置中心的能力缓存、检查结果和试生成结果。

另外新增 `settingsConnectionView: 'text'`。

## 5. P2：从消息生成提示词

- 把 `actions/api-chat-completion-connection.js` 里五个局部函数提到新文件 `core/chat-completion-request.js` 并导出，原工厂改为 import，行为不变（现有 `modern-api` e2e 测试兜底）。五个函数是：`getChatCompletionSettingsForTest`、`responseContentToText`、`extractReasoningText`、`readConnectionTestReply`、`createChatCompletionRequestBody`（`:21-119`）。
- 新文件 `actions/chat-image-prompt.js`：
  - `buildPromptMessages({ template, appearance, selected })` 是纯函数，生成「system = 模板；user = 角色外貌 + 『名字: 内容』格式的勾选消息」。
  - 调用 `/api/backends/chat-completions/generate`，带 `stream: false` 和 AbortController。
  - 用 `readConnectionTestReply` 解析结果，它会先检查 HTTP 200 里夹带的 `{ error }`。
  - 只支持 `main_api === 'openai'`（聊天补全），其他情况显示原型里的提示。
- 角色外貌：单聊取角色卡的 `description`；群聊取勾选消息里出现的所有角色（已确认）。
- 勾选上限 20 条或 6000 字。

## 6. 顺带修复的既有问题

- `saveModernChatNow` 的完整性冲突提示永远不会出现：代码检查的是 `result?.error === 'integrity'`（`actions/chat-context.js:566-568`），但服务端返回的是 HTTP 400 加 `{error:'integrity'}`（`src/endpoints/chats.js:1038-1041`），被 `apiFetch` 当成普通 400 抛出（静态确认）。改为识别 `error.status === 400` 且 body 里的 `error` 为 `integrity`。图片写入也会走这条路径。
- 要确认自动摘要统计「距上次摘要的消息数」时是否会把 `is_system` 消息算进去（`core/chat-summary.js` 里没有提到 `is_system`，推断会算），会的话就排除掉。

## 7. 并行开发拆分

仓库规则禁止新建分支和 worktree，所有并行任务共用同一个工作区，所以**按文件划分归属**：每个文件只归一个任务包。多个任务都要改的共享文件，在第 0 步由集成者一次改好。

### 7.1 第 0 步：契约与骨架（集成者先做，串行，约半天）

> - `core/state.js`：新增 `chatImageGeneration`、`imageModelSettings`、`settingsConnectionView`。
> - `core/image-message.js`：写完整实现和单测（纯函数、体量小，又是 WP2 和 WP3 共同依赖的契约）。
> - `core/chat-image-state.js`：`ensureChatImageState` 和 `messageIdentity`。
> - 空文件占位并登记：`actions/chat-image-generation.js`（在 `shell/feature-slot-actions.js:46-61` 登记）、`routes/chat-image-events.js`（在 `routes/chat-tools-events.js:22-29` 的处理器列表里登记）、`routes/image-model-events.js`。
> - `core/test-flags.js`：登记插槽 `chatImageModeToggle`。
> - `public/modern/index.html`：引入 `styles/routes/chat-image.css` 和 `styles/routes/image-model.css`。
> - `components/chat-message.js`：加入 `renderSelection` 和「图片消息分支」两个调用点，先连到占位函数。
> - `components/chat-composer.js`：加入元信息行插槽和图片模式分支的调用点。

### 7.2 并行任务包

| 任务包 | 内容 | 独占的文件 | 测试 |
| --- | --- | --- | --- |
| **WP1 设置中心图片模型** | 第 3 节全部，P2 设置卡留空位 | `components/settings-image-model.js`、`routes/image-model-events.js`、`actions/image-model-settings.js`、`core/image-generation-options.js`、`styles/routes/image-model.css`；在 `components/api.js`、`routes/api-events.js` 里做少量委托 | Jest：选项表和 `resolveImageModelField`；e2e：新建 `tests/modern-image-model-settings.e2e.js`，自己 mock `/api/image-generation/capabilities` 和 secrets |
| **WP2 输入框与生成流程** | 4.1、4.3：图片模式输入框、加锁、生成、恢复、写入、失败卡片、停止改调 cancel、C5 的按钮禁用 | `components/chat-image-composer.js`、`actions/chat-image-generation.js`、`routes/chat-image-events.js`、`styles/routes/chat-image.css`（输入框部分）；在 `chat-composer.js`、`chat-generation.js` 里做少量修改 | Jest：生成动作，注入假的 `apiFetch` 和 `updateModernChatAndSync`；e2e：新建 `tests/modern-chat-image.e2e.js`，mock `/api/image-generation/*`，`/user/images/**` 返回 PNG 字节；同时更新 `tests/modern-chat-connection.e2e.js:183-193` 和 `tests/modern-slots.e2e.js` 里元信息行顺序的断言 |
| **WP3 图片消息展示** | 4.2：图片卡片、版本切换、大图浮层、生成中卡片、空会话分支，媒体网格跳过图片消息 | `components/chat-image-message.js`、`components/chat-image-lightbox.js`、`components/chat-thread.js`、`components/chat-message-content.js`；在 `styles/routes/chat-image.css` 里放消息相关部分（与 WP2 约定按注释分区，或拆成两个文件） | Jest：渲染函数输出（字符串断言）；e2e：并入 `modern-chat-image.e2e.js`（先建好文件骨架，每个包各写自己的 describe） |
| **WP4 既有问题修复** | 第 6 节 | `actions/chat-context.js` 的完整性分支、`core/chat-summary.js` | Jest：完整性冲突时给出友好提示；摘要计数排除 `is_system` |
| **WP5a P2 基础** | 第 5 节中与界面无关的部分：提取公共请求函数、提示词消息构造、生成提示词动作 | `core/chat-completion-request.js`、`actions/api-chat-completion-connection.js`、`actions/chat-image-prompt.js` | Jest：`buildPromptMessages` 和回复解析；原有 `modern-api` e2e 全部通过 |

### 7.3 第 2 步：集成（串行）

> - 跑全量 Jest、conversation 单测、`npm run lint`、`npm run typecheck:modern`，以及相关 e2e（`tests/modern-*.e2e.js` 里涉及聊天和设置的部分）。
> - 在预览面板里手动走一遍：配置 → 手动生成 → 版本 → 删除 → 失败和结果未知（mock）→ 刷新页面后找回结果。
> - 更新 `MODERN_UI_ARCHITECTURE.md`：登记 `chat-composer.js` 例外、新插槽、新状态字段。

### 7.4 第 3 步：P2 界面接线（WP5b，在第 2 步之后）

> - 勾选模式的 `renderSelection` 实现、提示条、步骤条第 1–2 步，接到 WP2 的输入框和 WP5a 的动作上。
> - 在 WP1 留好的空位里填上 P2 设置卡。
> - e2e：在 `modern-chat-image.e2e.js` 里补「从消息生成」场景。

依赖关系：第 0 步 → { WP1, WP2, WP3, WP4, WP5a } 并行 → 第 2 步集成 → WP5b → 收尾。

## 8. 测试与验收

- 单测全部是 Jest node 环境下的纯函数和注入依赖的动作测试，不依赖 DOM。
- e2e 跟随现有做法：Playwright 启动真实 `node server.js`，用 `page.route` mock 接口（`tests/playwright.config.js:150-151`），用 `mockBridgeFrame` 记录发给旧引擎的调用，并断言写入 `/api/chats/save` 的消息结构。
- 验收要点：
  - 生图期间文本发送不可用；文本生成期间生图不可用。
  - 「停止」走 `/cancel`。
  - 同一个 `requestId` 不会重复计费。
  - 最后一条是图片时，继续和重生成不可用。
  - 刷新页面后能找回进行中的结果。
  - 设置中心没有保存按钮；图片字段的错误不影响文本连接测试。

## 9. 待确认

> 1. **C4**：一次生成多张图时，按「多个版本 + 切换」展示，而不是原型里的网格。
> 2. **C5**：最后一条是图片消息时，「继续」「重生成」不可用。另一种做法是让「重生成」跳过图片、去重生成图片前那条 AI 回复，但这要改旧引擎的语义，改动和风险都大得多。
> 3. **C6**：生成期间切换了会话，图片仍插入发起时的会话。
> 4. **F1**：复用全局生成锁。后果是图片生成的最长 5 分钟里，任何会话都不能发文本。

## 10. 附：`engine.generating` 现有的禁用点（静态确认）

- 输入框的发送、继续、重生成、文本框：`components/chat-composer.js:36, 49-70`；`routes/chat-input-events.js:72-82`。
- 连接切换：`actions/connection-profiles.js:969`。
- 消息翻译、候选回复、编辑、删除：`components/chat-message.js:186, 230, 241, 277`；`actions/chat-messages.js:71, 107, 146, 201`。
- 会话元数据写入：`actions/chat-context.js:655`。
- Agent 开关：`components/chat-agent.js:8`。
- 副作用：生成结束时触发提示词估算刷新（`shell/inspector.js:60-70`），对图片生成无害。

## 11. 实现时的文件调整（2026-10-12）

为了让并行任务包各自独占文件，实现时对第 4、7 节的文件划分做了这些调整，行为不变：

- 大图浮层没有单独成文件，放在 `components/chat-image-message.js`（`renderImageLightbox`）。
- 样式拆成四个文件：`styles/routes/chat-image-composer.css`（输入框，WP2）、`chat-image-message.css`（图片消息、任务卡片、大图，WP3）、`chat-image-selection.css`（勾选模式，WP5）、`image-model.css`（设置中心，WP1）。
- 动作和事件按任务包分文件：`actions/chat-image-generation.js` + `routes/chat-image-events.js`（WP2）、`actions/chat-image-view.js` + `routes/chat-image-message-events.js`（WP3）、`actions/chat-image-prompt.js` + `routes/chat-image-prompt-events.js` + `components/chat-image-selection.js`（WP5）、`actions/image-model-settings.js` + `routes/image-model-events.js` + `components/settings-image-model.js`（WP1）。
- `chat-thread.js` 和 `chat-message.js` 的接入点在第 0 步统一加好；`chat-message-content.js` 不需要改，图片消息整条由 `renderImageMessage` 渲染。
- e2e 每个任务包一个文件：`tests/modern-chat-image.e2e.js`、`modern-chat-image-message.e2e.js`、`modern-chat-image-prompt.e2e.js`、`modern-image-model-settings.e2e.js`。
- 第 5 节的 P2 与 P1 同时开发（WP5 一次做完 5a 和 5b），P2 设置卡归 WP1。
