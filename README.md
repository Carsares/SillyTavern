# SillyTavern Modern Workspace

本仓库当前以新版现代化界面作为默认用户入口。根路径 `/` 会保留查询参数并重定向到 `/modern/`，新版页面由 `public/modern/index.html` 和 `public/modern/app.js` 启动。

旧版 `public/` 页面、后端接口和数据结构仍保留，用于兼容 SillyTavern 既有能力；常规用户可见入口不应再跳回旧版页面。聊天生成能力会通过隐藏 `legacy bridge` 复用既有引擎，但这不是用户可见导航链路。

## 新版界面范围

新版界面已经承接这些用户可见页面：

- 工作台：资源概览、最近会话、状态入口。
- 聊天工作区：角色/群组会话选择、消息读取与编辑、发送、生成、聊天文件导入导出、备份管理。
- 角色库：角色创建、编辑、导入、复制、重命名、头像替换、删除。
- 群组管理：群组创建、编辑、成员管理、群组聊天入口。
- 世界书：世界书创建、导入导出、全局启用、条目 CRUD、高级字段、批量启停和删除。
- 预设管理：预设浏览、使用、导入、复制、导出、恢复和删除。
- 用户人设：人设创建、头像上传、默认人设切换和删除。
- 素材库：背景上传、重命名、删除、文件夹管理、资产下载和删除。
- 远程资源：独立聚合官方内容索引、GitHub/GitLab 扩展搜索、RisuRealm、Chub/CharacterHub、Character Tavern、AICharacterCards 和 LoreBary 搜索，支持远程搜索、下载/导入、扩展安装、URL 导入、导入记录和资源站凭据保存状态。
- API 连接管理：聊天补全和文本补全配置、密钥写入、模型刷新、连接测试、请求压缩配置。
- 扩展：本地扩展查看、安装、更新、分支切换、移动和删除。
- 活动与统计：近期资源活动、对象跳转和统计状态。
- 设置中心：现代界面偏好、设置快照创建、预览和恢复。

## 代码结构

新版前端代码集中在 `public/modern/`：

- `index.html`：新版 shell 的 HTML 入口和样式引用。
- `app.js`：启动装配层，创建状态、API client、actions、routes、shell renderer 和全局事件绑定。
- `core/`：API client、状态、常量、通用工具和隐藏 legacy bridge。
- `shell/`：导航、路由、命令面板、顶部栏、inspector、数据加载和渲染编排。
- `routes/`：各页面的渲染模块和事件绑定模块。
- `actions/`：角色、群组、世界书、预设、聊天、素材、API、扩展、设置等业务动作。
- `components/`：页面组件和可复用 UI 片段。
- `styles/`：基础、shell、布局、覆盖层、响应式和 route 级样式。

服务入口在 `src/server-main.js`：

- `/`：登录校验后重定向到 `/modern/`。
- `/modern`、`/modern/`、`/modern/index.html`：返回新版界面。
- `/callback/:source?`：OAuth 回调后继续回到根入口，最终进入新版。

远程资源后端集中在 `src/remote-resources/` 和 `src/endpoints/remote-resources.js`：

- provider 只接入固定资源站，不提供任意 URL 代理；外部下载由 provider 校验资源 ID 后执行。
- 匿名 provider 默认可用；GitHub token、Chub cookie、RisuRealm token 通过现有 `secrets.json` 保存，前端只显示遮罩状态。
- 导入后的来源关系写入用户目录下的 `remote-resources/imports.json`，不污染角色卡、世界书或扩展自身文件。
- Chub 搜索不直接从 Node 请求 `ro.chub.ai/search`，而是每次自动拉起独立的后台 headless Chrome/CDP 打开 Chub 搜索页，读取前端实际消费的 JSON 响应，并在调用完成后关闭进程；登录态通过 Chub cookie 或 `SILLYTAVERN_CHUB_CDP_PROFILE` 指向的持久 profile 目录保留。
- JannyAI 搜索使用公开 Meilisearch 角色索引，下载时读取匿名详情页里的 SSR 角色字段并转换为 SillyTavern 角色 JSON。
- Character Tavern 搜索使用 `character-tavern.com/api/search/cards`，下载时读取 `api/character/:author/:name` 并转换为 SillyTavern 角色 JSON。
- AICharacterCards 搜索使用 `api.aicharactercards.com/api/cards`，下载通过 `/cards/:id/versions` 获取当前 PNG 角色卡。
- LoreBary 搜索使用 `/api/lorebook/public` 和 `/api/plugin`，世界书可导入，LoreBary plugin 作为 `preset` 类型下载，不当作 SillyTavern 扩展安装。
- Bronya Rand Archive 搜索读取静态 `world-lore-books` 索引，只允许下载归档内 `world-info/**/*.json` 世界书。
- Hugging Face ST Repos 搜索已验证的公开 SillyTavern 资源仓库文件树，只返回角色卡和预设 JSON。
- Chatbots Webring 搜索 `chatbots.neocities.org` 静态成员站点，只抓取成员同源的 `/cards/*.png` 角色卡和预设 JSON 文件。
- GitLab 扩展搜索使用 GitLab 公开 Projects API，只返回可安装 Git URL。

Chub CDP 搜索可选环境变量：

- `SILLYTAVERN_CHUB_CDP_PORT`：自动拉起 Chrome 时使用的固定端口；未配置时每次分配临时可用端口。
- `SILLYTAVERN_CHUB_CHROME_PATH`：Chrome/Chromium 可执行文件路径，未配置时按平台默认路径查找。
- `SILLYTAVERN_CHUB_CDP_PROFILE`：自动拉起 Chrome 使用的持久 profile 目录；未配置时每次使用临时 profile，并在调用结束后删除。

## 后端契约

新版界面复用现有 `/api/...` 后端契约，不引入 modern-only 后端分支。前端应保持请求 payload、返回结构、错误处理和本地状态语义与既有接口兼容。

任何新增或调整的新版 API 调用都必须同步更新 real-backend E2E 覆盖，确保从新版 UI 触发的请求能真实打到后端并验证用户可见结果。当前审计口径要求 `public/modern/**/*.js` 中声明的 API 路径在 `tests/modern-real-backend-integration.e2e.js` 中没有覆盖缺口。

## 本地启动

要求 Node.js `>= 20`。

```bash
npm install
cd tests && npm install && cd ..
```

启动新版界面调试服务：

```bash
nice -n 19 npm run start -- --port 8011 --browserLaunchEnabled=false
```

访问：

- `http://127.0.0.1:8011/`
- `http://127.0.0.1:8011/modern/`

两个入口都应进入新版界面。

## 验证命令

文档-only 改动至少执行：

```bash
git diff --check ; echo EXIT=$?
```

前端 JS 改动至少执行语法检查和 lint：

```bash
find public/modern -name '*.js' -print0 | xargs -0 -n 1 node --check ; echo EXIT=$?
nice -n 19 npm run lint ; echo EXIT=$?
git diff --check ; echo EXIT=$?
```

运行 modern E2E 时固定使用 headless/list reporter，不打开可视浏览器或 HTML report：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test "tests/modern-.*\\.e2e\\.js" --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

只跑真实后端集成覆盖：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-real-backend-integration.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

远程资源的默认真实后端集成覆盖 provider/记录/凭据和官方索引搜索。涉及公网下载或第三方安装的链路需要在外部依赖回归中显式执行，避免普通本地回归误依赖公网状态。

外部依赖真实回归默认跳过，避免普通本地回归误打公网、真实 GitHub 仓库或供应商 API。需要验证公网资产下载、真实扩展安装/更新、真实 OpenRouter 供应商调用时，显式开启：

```bash
MODERN_EXTERNAL_E2E=1 \
MODERN_EXTERNAL_OPENROUTER_API_KEY=... \
MODERN_EXTERNAL_OPENROUTER_MODEL=... \
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-external-dependencies.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

可选覆盖项：

- `MODERN_EXTERNAL_ASSET_URL`：外部资产 URL，默认使用 `raw.githubusercontent.com` 白名单域名下的公开文件。
- `MODERN_EXTERNAL_ASSET_EXPECT`：下载文件内容断言片段。
- `MODERN_EXTERNAL_EXTENSION_URL`：外部扩展 Git URL，默认使用公开 SillyTavern 扩展仓库。
- `MODERN_EXTERNAL_EXTENSION_BRANCH`：外部扩展分支，默认 `main`。
- `MODERN_EXTERNAL_EXTENSION_NAME`：扩展目录名，默认从 Git URL 推导。

远程资源手工外部回归建议覆盖：

- RisuRealm：`/modern/?view=remoteResources` 搜索 `tag:lorebookincluded`，类型选择角色卡，导入一张公开角色后清理本地角色和导入记录。
- Chub/CharacterHub：远程资源搜索 `cat` 且类型选择角色卡，确认出现 Chub 结果并可导入；URL 导入 `https://chub.ai/lorebooks/bartleby/toaru-sillytavern`，确认世界书导入成功后清理本地世界书和导入记录。
- 凭据槽位：资源站账号页保存一个临时 GitHub token 后立即删除，确认只显示遮罩状态。

## 新版开发规则

- 不新增常规用户可见的“打开原版”“打开旧版”入口。
- 不为了兼容少数极端路径引入双链路、降级或临时补丁。
- route、action、component、style 按现有目录归属就近演进。
- 只移动或拆分代码时保持 API payload、错误文案、默认值、localStorage key 和 DOM data selector 稳定。
- 新增 API 调用时，同步补 real-backend E2E，并确认 endpoint audit 无缺口。
- 涉及真实供应商、公网 Git 或外部 URL 的链路，同步补 `modern-external-dependencies.e2e.js` 或对应外部依赖测试。
- 每个功能点按可验证的小提交推进。

## 上游资源

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## Backend Interface Logs

When `logging.enableAccessLog` is enabled, backend interface access and error logs are written under `/var/logs/SillyTavern`. Logs are grouped by local date as `/var/logs/SillyTavern/YYYY-MM-DD/access.log` and `/var/logs/SillyTavern/YYYY-MM-DD/error.log`.

Access logs cover backend interface requests with request ID, method, path, status, duration, IP, user agent and user identity when available. Error logs cover request-scoped warnings/errors, uncaught interface errors and 5xx interface responses. Use the request ID to correlate `access.log` and `error.log` entries. During server startup, dated log directories older than one week are removed.

## License

AGPL-3.0
