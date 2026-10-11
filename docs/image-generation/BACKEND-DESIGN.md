# 会话内图片生成 · 后端详细设计（P1）

> 状态：后端 P1 已实现（2026-10-12，未提交）；第 12 节列出实现与本稿的差异。初稿日期 2026-10-11。
> 配套界面原型：`output/image-generation-mockup.html`（已定稿）。前端设计（API 页「图片模型」分区、聊天页输入框）等 API 页重构提交后另写。
> 文中「已核对」指读过当前代码；「推断」指没有运行验证。

## 1. 范围

P1 后端交付这些内容：

- 新增图片密钥键 `api_key_image_generation`。
- 新增接口模块 `/api/image-generation`，提供四个接口：能力查询、生成、结果查询、取消。
- 给共享的供应商适配层加两个可选开关，默认行为不变，Agent 不受影响。
- 自动化测试。

不在本稿范围：

- 前端实现。
- P2「从消息生成提示词」不新增后端接口，结论见第 8 节。
- 排队类供应商（Horde、ComfyUI、BFL、fal）、多套图片配置、Agent 会话接入。

## 2. 总体结构

```text
Modern 前端
  │  POST /api/image-generation/generate   { requestId, provider, baseUrl, model, secretId, 参数… }
  ▼
src/endpoints/image-generation.js（私有路由：登录 + CSRF）
  ├─ 校验字段 → 按 secretId 读密钥（secrets.json）
  ├─ createAuxiliaryAdapter({ type: 'image', … }, { fetch: 全局 agent 的 fetch })
  │     └─ generateImage(参数) ──► 图片供应商
  ├─ 结果是 base64 → 直接解码；结果是网址 → downloadImage（仅公网 HTTPS，≤ 8 MiB）
  ├─ 写文件 → <用户目录>/user/images/<角色名>/<文件名>
  └─ 返回 { images: [{ path: '/user/images/…', … }] }
前端拿到 path 后写进聊天消息的 extra.media[].url（前端设计负责）
```

### 2.1 关键决定

| 编号 | 决定 | 理由 |
| --- | --- | --- |
| D1 | 新建 `src/endpoints/image-generation.js`，挂在 `/api/image-generation` | 作为通用后端接口，而不是 Modern 专用后端，符合 `MODERN_UI_ARCHITECTURE.md:56` 的约束。注册方式与 `/api/sd` 相同（`src/server-startup.js:146-195`）。 |
| D2 | 复用 `src/conversation/providers/auxiliary/` 的 `createAuxiliaryAdapter().generateImage()`，不复用旧的 `/api/sd/*` | 适配层用统一参数（`prompt/width/height/count/quality/…`）覆盖约 30 家，并有按供应商列出的参数表（`src/conversation/capabilities/auxiliary/index.js:39-61`），协议测试已有（`tests/conversation/modules/providers/auxiliary-images.test.mjs`）。旧接口每家请求格式不同，而且只读该供应商当前激活的那把公共密钥，做不到「图片单独一套密钥」。 |
| D3 | 非密钥配置由前端放在请求体里；密钥只在服务端按 id 读取 | 与 `/api/sd/*` 从请求体取地址的做法一致，也方便单次生成临时改参数。浏览器从头到尾拿不到密钥明文。 |
| D4 | 出站请求走主程序的全局 HTTP agent | 这样 `config.yaml` 里的 `requestProxy` 和 `privateAddressWhitelist` 对生图请求同样生效。这两项只作用于 `http(s).globalAgent`（`src/request-proxy.js`、`src/private-request-filter.js`），而适配层现有的 `createConnectionFetch` 会传自己的 agent 绕开它们，所以需要第 6.1 节的开关。 |
| D5 | 浏览器断开不中止生成；结果在内存里保留 30 分钟供查询；只有显式「取消」才中止 | 生图按次计费。前端遇到超时或断网时，可以先查结果，不用重新提交。这也是原型里黄色「结果未知」卡片背后的能力。 |

## 3. 配置与密钥

### 3.1 非密钥配置（前端保存，P1 后端不读）

保存位置是 `settings.json` → `extension_settings.imageGeneration`，走现有的整份 settings 保存流程。

```js
extension_settings.imageGeneration = {
    provider: 'openai',            // 第 4.1 节白名单里的 id
    baseUrl: '',                   // 空 = 用供应商默认地址；openai-compatible 必填
    model: 'gpt-image-1',
    secretId: '',                  // secrets.json 中 api_key_image_generation 的某个条目 id
    defaults: { width: 1024, height: 1024, aspectRatio: '', quality: 'high', style: '', count: 1,
                negativePrompt: '', seed: null, steps: 28 },
    promptGen: { template: '…', defaultSelectCount: 3, includeAppearance: true },
};
```

- 不放进 `extension_settings.sd`。旧版生图扩展在隐藏旧引擎（bridge）里照常加载并读取这个键，如果开着 `interactive_mode` 或 `function_tool`，会自己出图（`public/scripts/extensions/stable-diffusion/index.js:375-434`）。
- 设置快照和账户备份都会带上 `settings.json`（`src/endpoints/settings.js:148-159`），所以这里不能出现密钥。

### 3.2 密钥

- 在 `src/endpoints/secrets.js:9-77` 的 `SECRET_KEYS` 里加 `IMAGE_GENERATION: 'api_key_image_generation'`。不加的话，`/api/secrets/write` 照样能写进去，但 `/api/secrets/read` 不返回它的状态，前端就显示不出「已保存」（已核对：`getSecretState` 只遍历 `SECRET_KEYS`，`secrets.js:365-390`）。
- 一个键下可以存多条，每条带 id。前端用现有的 `POST /api/secrets/write { key, value, label }` 写入，拿到返回的 `{ id }` 后存成 `secretId`。
- 服务端读取用 `readSecret(request.user.directories, SECRET_KEYS.IMAGE_GENERATION, secretId || null)`。传了 id 却对不上时返回空字符串，不会退回当前激活的条目（已核对：`secrets.js:290-304`），这种情况按「密钥缺失」处理。
- 不加入 `EXPORTABLE_KEYS`（`secrets.js:105-110`），保持打码显示。账户备份本来就跳过 `secrets.json`（`src/users.js:1212-1221`）。
- 本地 SD WebUI 允许没有密钥。

## 4. 接口

通用约定：

- 全部是私有路由，需要登录，POST 还要带 `X-CSRF-Token`，Modern 的 `apiFetch` 会自动带上。
- 失败时返回 HTTP 状态码加 `{ error, message, detail?, outcome }`，沿用 `src/endpoints/translate.js:18-22, 59-61` 的约定，再加一个 `outcome` 字段，见第 5 节。
- 错误信息和日志里不出现提示词、密钥、带参数的网址。

### 4.1 `POST /api/image-generation/capabilities`

供 API 页的「检查配置」和聊天页参数区使用。不发任何外部请求，不计费。

请求：`{ provider, model, baseUrl? }`

响应：

```json
{
  "supported": true,
  "provider": "openai",
  "api": "openai-auxiliary",
  "parameters": ["width", "height", "count", "quality", "style", "outputFormat"],
  "limits": { "countMax": 4, "maxDimension": 4096, "dimensionMultiple": null },
  "requiresBaseUrl": false,
  "requiresKey": true,
  "keySaved": true
}
```

- P1 只开放 6 个 provider id：`openai`、`openai-compatible`、`google`、`openrouter`、`novelai`、`automatic1111`（界面名「本地 SD WebUI」）。其他 id 返回 400 `unsupported-provider`，即使适配层支持也一样。
- `parameters` 取自 `getAuxiliaryCapabilities({ provider, model, baseUrl, type: 'image' }).operationParameters.generateImage`，去掉 `prompt`、`jobId`、`onJob`。
- 有三处按模型修正，因为参数表比编解码器宽：
  - Gemini 图片模型 `countMax = 1`，编解码器只接受一张（已核对：`image-native.js:138`）。
  - NovelAI `dimensionMultiple = 64`（已核对：`novelai.js:11`）。
  - OpenAI 不支持反向提示词（已核对：`providers/auxiliary/index.js:62`），参数表里本来也没有 `negativePrompt`，无需额外处理。
- `keySaved` 只看对应条目是否非空，不返回任何密钥信息。

### 4.2 `POST /api/image-generation/generate`

请求字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `requestId` | 是 | 前端生成的 UUID，用于去重和事后查询 |
| `provider` / `model` / `baseUrl` | provider、model 必填 | 同第 4.1 节 |
| `secretId` | 否 | 不传时读取当前激活的条目 |
| `characterName` | 是 | 决定存放的子目录；群聊传群名 |
| `prompt` | 是 | 1–8000 字（与 Agent 工具上限一致，`src/conversation/tools/index.js:14`） |
| `negativePrompt` `width` `height` `aspectRatio` `imageSize` `quality` `style` `count` `seed` `steps` `outputFormat` | 否 | 只能传该供应商 `parameters` 里有的字段，其余返回 400 |

处理步骤：

1. **校验**：provider 在白名单内，`requestId` 是 UUID，参数字段属于该供应商。字段合法性交给适配层的 `validateImageOptions`（`image-native.js:13-25`）。
2. **并发和去重**：
   - 同一用户已有进行中的请求时，返回 409 `image-generation-busy`。这与原型「生图期间不允许再提交」的规则一致，也能防止重复点击或多个标签页同时提交。
   - `requestId` 已有记录时直接返回记录的状态和结果，不再调用供应商。
3. **读密钥**：读不到且该供应商需要密钥时，返回 400 `secret-missing`。
4. **组装连接**：

   ```js
   { provider, type: 'image', model, baseUrl: baseUrl || undefined, apiKey, timeoutMs: 300000 }
   ```

   然后调用 `createAuxiliaryAdapter(connection, { fetch: createConnectionFetch(connection, { agent: 'global' }).fetch })`。适配层默认超时 120 秒（`providers/chat/http.js:30`），高质量出图可能超过，所以设为 5 分钟。
5. **生成**：调用 `adapter.generateImage({ prompt, …参数, signal })`。`signal` 来自这次请求自己的 `AbortController`，存在进行中记录里，不绑定浏览器连接（D5）。
6. **落盘**：
   - `{ data }` 直接解码；`{ url }` 用 `downloadImage(url, { signal })`（`src/conversation/composition/download.js`：只下载公网 HTTPS 443、最多 3 次跳转、≤ 8 MiB、校验文件头）。
   - 只接受 png、jpeg、webp，并用文件头核对 MIME。
   - 目录是 `request.user.directories.userImages/<文件夹名>/`。文件夹名取 `sanitize(characterName)`，再把 `%`、`#` 替换成 `_`，因为静态路由会对路径做 `decodeURIComponent`，`%` 会导致 500（已核对：`src/users.js:1097`）。结果为空时用 `generated`。
   - 文件名由服务端生成：`<文件夹名>_<YYYY-MM-DD@HHhMMmSSs>_<序号>.<扩展名>`，写入用 `writeFileAtomicSync`。
   - 宽高用已有依赖 `image-size` 读取。
7. **返回**：

```json
{
  "requestId": "…",
  "status": "completed",
  "images": [{ "path": "/user/images/莉亚/莉亚_2026-10-11@22h04m10s_1.png", "mimeType": "image/png", "bytes": 1834221, "width": 1024, "height": 1024 }],
  "provider": "openai",
  "model": "gpt-image-1",
  "elapsedMs": 18342,
  "incomplete": 0
}
```

- `path` 是原样路径，不做 URL 编码，因为 Data Maid 按原样路径比对引用（已核对：`src/endpoints/data-maid.js:189-227`）。
- 供应商返回多张图、其中部分保存失败时，仍返回 `completed`，`images` 只列出保存成功的，`incomplete` 记录失败张数。一张都没保存成功时，按第 5 节的 `save-failed` 处理。

### 4.3 `GET /api/image-generation/requests/:requestId`

前端在超时或断网后调用，用来找回结果。

- 响应：`{ requestId, status: 'pending' | 'completed' | 'failed' | 'cancelled', startedAt, images?, error? }`。
- 记录只存在内存里，按用户分开。每个用户最多保留 50 条，完成后保留 30 分钟。超过时间或服务重启后返回 404；重启前已经写盘的图片仍在目录里。
- 只查本用户的记录。查到别人的 id 也一律返回 404。

### 4.4 `POST /api/image-generation/cancel`

对应原型的「停止等待」。

- 请求：`{ requestId }`。
- 中止进行中的供应商请求，状态改为 `cancelled`，返回 `{ status: 'cancelled', outcome: 'unknown' }`。供应商可能已经开始生成并计费，所以结果标为未知。
- 重复调用效果相同；id 不存在时返回 404；请求已完成时原样返回完成状态。

## 5. 错误口径

`outcome` 字段告诉前端这次失败是否可能已经计费：

- `not-charged`：请求还没发到供应商。
- `unknown`：已经发出，可能计费。
- `charged`：供应商已成功出图，但本地处理失败。

| HTTP | `error` | 什么时候出现 | `outcome` |
| --- | --- | --- | --- |
| 400 | `invalid-request` | 缺字段、字段不合法、该供应商不支持某个参数 | not-charged |
| 400 | `unsupported-provider` | provider 不在 P1 白名单 | not-charged |
| 400 | `secret-missing` | 需要密钥但没读到 | not-charged |
| 409 | `image-generation-busy` | 同一用户已有进行中的请求 | not-charged |
| 502 | `provider-http-error` | 供应商返回非 2xx；`detail` 是脱敏后的供应商原因（第 6.2 节） | unknown |
| 502 | `provider-response-invalid` | 返回格式不对、图片超限 | unknown |
| 502 | `provider-network-error` | 网络失败 | unknown |
| 504 | `provider-timeout` | 超过 5 分钟 | unknown |
| 502 | `image-download-failed` | 供应商给了网址，但下载失败 | charged |
| 500 | `save-failed` | 写文件失败 | charged |

- 从适配层错误到 `outcome` 的映射：适配层对 `invalid-input`、`invalid-image-options`、`unsupported-parameters` 这类请求前错误不标 outcome，对其余错误标 `details.outcome = 'unknown'`（已核对：`providers/auxiliary/index.js:107-115`）。本模块照此转换。
- 日志用 `console.warn` 记 `requestId`、provider、model、错误码、耗时，不记提示词、密钥、网址参数。

## 6. 共享适配层的两处改动（默认行为不变）

### 6.1 `createConnectionFetch` 新增 `agent: 'global'` 选项

- 位置：`src/conversation/providers/core/proxy.js:68`。
- 现状：它总会创建 `VerifiedProxyAgent` 并显式传给 node-fetch，主程序的全局代理和私网过滤因此不生效。
- 改法：传入 `{ agent: 'global' }` 时不创建自己的 agent，node-fetch 用 `http(s).globalAgent`。同时要求连接上没有 `proxy` 字段，有的话报 `invalid-transport`。
- Agent 现有调用不传这个选项，行为不变。

### 6.2 `createTransport` 新增 `errorDetail: true` 选项

- 位置：`src/conversation/providers/chat/http.js:25`。
- 现状：供应商返回非 2xx 时直接丢弃响应体，只留下 `Provider returned HTTP 400`（已核对：`http.js:51-55`），用户看不到「触发内容策略」这类原因。
- 改法：开启时读取最多 4 KB 响应体，依次提取 `error.message`、`message`、`detail`、字符串类型的 `error`，用 `createRedactor(connection)` 脱敏，截断到 300 字，放进 `error.details.providerMessage`。默认关闭，Agent 行为不变。
- 本模块开启它，把 `providerMessage` 作为响应里的 `detail`。

## 7. 数据落点与清理

- 图片文件放在 `<用户目录>/user/images/<角色名>/`，通过已有的 `/user/images/*` 路由访问，需要登录（`src/users.js:1257`）。
- 聊天消息由前端写入，图片路径记在 `extra.media[].url`，消息格式在前端设计里定。Data Maid 只认 `url` 字段，扫描 `user/images` 及其下一层子目录（`data-maid.js:228-243`），本方案的路径正好在一层子目录里，所以被引用的图片不会被当成孤儿文件。
- 删除图片消息不删除文件（与原型一致），没有被任何消息引用的文件由 Data Maid 清理。

## 8. P2 提示词生成：后端不新增接口

- 结论：复用现有的 `POST /api/backends/chat-completions/generate`，传 `stream: false`。它已经处理了各来源的密钥和特殊字段（`src/endpoints/backends/chat-completions.js:2148-2622`），新做一个接口只会重复这些逻辑。
- 留给前端设计的事项：
  - 前端现成的请求体构造函数 `createChatCompletionRequestBody` 是工厂里的局部函数，没有导出，也缺 `secret_id`、Azure、Vertex、Workers AI 等字段（`public/modern/actions/api-chat-completion-connection.js`）。API 页重构后需要把它提到共享模块。
  - 非流式请求失败时，部分来源会返回 HTTP 200 加 `{ error }`（`chat-completions.js:2599-2600`），解析时要像 `readConnectionTestReply` 一样先检查 `error`。
  - 只支持聊天补全类主连接，与原型一致。

## 9. 测试计划

### 9.1 新增 `tests/image-generation-endpoint.test.js`

用 Jest ESM，写法参照 `tests/assets-download.test.js`（mock `node-fetch`、临时目录）和 `tests/translate-endpoint.test.js`（mock `secrets.js`）。

> 1. capabilities：6 个 provider 各自的参数列表；Gemini 的 `countMax` 是 1；未知 provider 返回 400；全程不发网络请求。
> 2. OpenAI 返回 base64：文件写进角色子目录，返回原样路径，文件头正确。
> 3. 供应商返回网址：走下载；非 HTTPS 网址被拒。
> 4. 按 `secretId` 读密钥：id 对不上时返回 400 `secret-missing`，且不调用供应商。
> 5. 向 OpenAI 传 `negativePrompt`：返回 400 `not-charged`，不调用供应商。
> 6. 供应商返回 400 且错误体里带密钥原文：响应 502，`detail` 里的密钥被替换成 `[REDACTED]`。
> 7. 第一单还在进行时提交第二单：返回 409。
> 8. 同一 `requestId` 完成后再提交：直接返回记录，供应商只被调用一次。
> 9. 浏览器断开不中止，结果能从 `requests/:id` 查到；调用 cancel 后状态变成 `cancelled`。
> 10. 角色名含 `%`、`#`、`../` 时：路径仍在 `userImages` 下，文件名安全。
> 11. 写文件失败：返回 500 `save-failed`，`outcome` 为 `charged`。

### 9.2 共享模块测试（node:test）

> - `tests/conversation/modules/providers/proxy.test.mjs`：`agent: 'global'` 不传自己的 agent；带 `proxy` 字段时报错。
> - `tests/conversation/modules/providers/providers.test.mjs`（或新文件）：`errorDetail` 开启时能提取原因并脱敏；关闭时行为与现在一致。

### 9.3 其他

- 执行命令：`npm run test:unit --prefix tests`、`npm run test:conversation:*` 中相关的一组、`npm run lint`。
- 自动化测试不覆盖真实供应商。第一批 6 家需要用真实密钥手动各试一次。

## 10. 改动清单

| 类型 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `src/endpoints/image-generation.js` | 四个接口、进行中和已完成请求的内存记录、落盘 |
| 新增 | `tests/image-generation-endpoint.test.js` | 第 9.1 节 |
| 修改 | `src/server-startup.js` | import，并在 `setupPrivateEndpoints` 里加 `app.use('/api/image-generation', …)` |
| 修改 | `src/endpoints/secrets.js` | `SECRET_KEYS.IMAGE_GENERATION` |
| 修改 | `src/conversation/providers/core/proxy.js` | `agent: 'global'` 选项 |
| 修改 | `src/conversation/providers/chat/http.js` | `errorDetail` 选项 |
| 修改 | 两个 conversation 测试文件 | 第 9.2 节 |

## 11. 风险与待验证

- 适配层注明各供应商都没有用真实服务验证过（`providers/auxiliary/index.js:2`）。上线前需要用真实密钥逐家验证。
- 「OpenAI 兼容」只适用于严格实现 OpenAI `images/generations` 参数的服务（推断）。SiliconFlow 等服务的参数名不同（如 `image_size`、`batch_size`），可能不兼容；原型 API 页里拿 SiliconFlow 当示例地址，前端定稿时要换掉。
- DALL·E 3 默认返回图片网址，下载时直连、不经过全局代理（`downloadImage` 用自己的固定 agent）。开了 `requestProxy` 的环境可能下载失败（推断）。这时返回 `image-download-failed`，`outcome` 为 `charged`。
- 进行中和已完成的请求记录只在内存里，服务重启后查不到，但重启前已写盘的图片仍在目录里。
- 服务端超时是 5 分钟；前端请求的超时要更长，建议 6 分钟，前端设计时确定。

## 12. 实现与本稿的差异（2026-10-12）

以下是实现时补充或调整的行为，代码在 `src/endpoints/image-generation.js`，均有测试覆盖。

- **图片类型以文件头为准**：保存的格式和扩展名按文件头判断（只收 PNG、JPEG、WebP），不要求与适配层报告的 MIME 一致。原因是 SD WebUI 适配层固定标成 `image/png`，WebUI 设成输出 JPG 时严格比对会丢掉已经出好的图。
- **生成请求的检查顺序**：字段校验 → 同 `requestId` 已有记录 → 单用户并发 → 密钥。同一 `requestId` 还在进行中时返回 `202 { requestId, status: 'pending', startedAt }`，不返回 409。
- **未发往供应商的拒绝不留记录**：字段错误、409 忙、`secret-missing` 都不写记录，同一 `requestId` 之后还能再用。
- **`null` 参数视为未设置**，与前端默认值 `seed: null` 对应。
- **`secretId`**：传了但找不到时，本地 SD WebUI 也返回 `secret-missing`。`/capabilities` 也接受可选的 `secretId`，`keySaved` 按它判断；不可用时附带 `reason`。
- **第 5 节以外的错误码**：查询和取消找不到记录时返回 404 `request-not-found`；被取消的原 `/generate` 请求返回 409 `cancelled`（`outcome: unknown`）；调用供应商之前的意外失败返回 500 `internal-error`（`not-charged`）；适配层的 `provider-error`、`provider-job-failed` 映射为 `provider-http-error`。
- **`errorDetail` 截断时多删一个词**：错误体超过 4 KB 被截断时，去掉截断处最后一个不含空白的片段。被截断的密钥前半段匹配不上脱敏规则，不删会原样带出。
- **文件名**：文件夹名里的 `%`、`#` 替换为 `_`，文件名前缀与文件夹名相同，例如 `/user/images/莉亚 __/莉亚 ___2026-10-12@00h19m24s_1.png`。
