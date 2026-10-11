# SillyTavern Modern Workspace

本仓库维护 SillyTavern 的 Modern Workspace 版本。根路径 `/` 会保留查询参数并重定向到 `/modern/`，新版页面由 `public/modern/index.html` 和 `public/modern/app.js` 启动。

旧版 `public/` 资源、既有后端接口和数据格式仍作为兼容层保留。常规用户可见导航不应跳回旧版页面；聊天生成可以通过隐藏的 legacy bridge 复用既有引擎。

## 启动完整应用与 Agent

要求 Node.js >=22.19。`npm ci` 安装锁定依赖，`npm start`（或 `start.sh` / `Start.bat`）启动原应用入口 `server.js`，通过 `CommandLineParser` 读取原有配置，默认进入 `/modern/`。已有聊天、角色、群组、世界书、API、扩展、素材、远程资源和设置页面继续使用原实现与数据。

Agent 是 Modern 导航新增的 `agent` 页面，不替换原聊天功能。其 `/api/conversation/v1` 挂载在原服务的认证与 CSRF 防护之后。服务端按已认证用户的数据目录建立 `conversation-v1/`；Agent 不自动导入或改写原聊天，但完整应用仍保留自身正常的配置初始化和数据处理流程。

原部署继续使用 `config.yaml`、`--configPath`、`--dataRoot` 及原有监听、用户、Host 白名单和认证配置。不要将独立 Agent 的 `CONVERSATION_PASSWORD` 当作完整应用的认证设置。对外访问仍应配置原应用认证及可信 HTTPS 代理；本次部署脚本不覆盖已有安全配置。

`npm run start:agent -- --port 8001 --dataRoot /absolute/isolated-data` 是可选独立服务，入口 `conversation-server.js`，不是默认应用。独立模式使用自己的 Host/Origin/密码规则，详见 [运行说明](docs/conversation/OPERATIONS.md)。不要与完整应用共用正在打开的 Agent 数据目录。

Docker 沿用上游原有的 `Dockerfile`、`docker/docker-entrypoint.sh` 和 `docker/docker-compose.yml`：`COPY . ./` 复制完整应用，Agent 代码随之进入镜像，Agent 数据落在挂载的 `data/<用户>/conversation-v1/`。`.dockerignore` 额外排除本地 `config.yaml` 和工具输出。Linux 容器内只能使用 PI 执行器，Claude/Codex 执行器依赖 macOS 沙箱。

Agent 文档：[架构](docs/conversation/ARCHITECTURE.md)、[协议](docs/conversation/CONTRACTS.md)、[实施状态](docs/conversation/IMPLEMENTATION.md)、[验证边界](docs/conversation/VALIDATION.md)。恢复完整应用后的端到端验证以这些文件中的本阶段记录为准，不复用此前独立服务结果作为通过依据。

## 当前界面范围

`public/modern/core/constants.js` 当前注册 14 个用户可见 route：

- 工作台；
- 聊天；
- Agent 会话；
- 角色；
- 群组；
- 世界书；
- 预设；
- 用户人设；
- 素材；
- 远程资源；
- API；
- 扩展；
- 活动；
- 设置。

新版已经承接对应页面的主要浏览、编辑、导入导出和管理流程。聊天工作区包含角色/群组会话、消息操作、生成、聊天文件和备份；API 页面包含聊天补全、文本补全、KoboldAI Classic、NovelAI 和 AI Horde 的连接配置。

在此基础上补充的用户可见能力（行为细节见 [MODERN_UI_ARCHITECTURE.md](MODERN_UI_ARCHITECTURE.md)，运维说明见 [MAINTENANCE.md](MAINTENANCE.md)）：

- 聊天：备用开场白切换、作者注释、聊天摘要（查看、编辑、重新摘要）、聊天背景、消息翻译（只改显示，不改原文）、跨角色和群聊的聊天搜索；输入框旁有连接档案与模型切换、「上次发送 / 预算」提示词用量；
- API 页：聊天补全和文本补全的上下文长度，连接档案的应用、创建和删除；
- 角色：导入并关联卡内嵌世界书，把角色卡翻译为中文并填入未保存的草稿；
- 设置：「聊天工具」标签（翻译、摘要）和「数据维护」标签（存储占用、未引用文件清理、重复的仅开场白会话、设置快照、聊天备份、完整数据导出）。

## 技术结构

新版前端集中在 `public/modern/`，服务入口位于 `src/server-main.js`，远程资源后端位于 `src/remote-resources/` 和 `src/endpoints/remote-resources.js`。

目录职责、route 归属、后端边界、provider 约束和测试责任统一维护在 [MODERN_UI_ARCHITECTURE.md](MODERN_UI_ARCHITECTURE.md)。

## 远程资源

`src/remote-resources/provider-registry.js` 是 provider 清单的唯一代码来源；当前注册 34 个 provider：

- 官方和扩展：SillyTavern 官方内容、GitHub 扩展搜索、GitLab 扩展搜索；
- 社区服务：RisuRealm、Chub / CharacterHub、Character Tavern、AICharacterCards、LoreBary、JannyAI、WyvernChat、Mnemo、SpicyChat、Backyard AI、DataCat、Botbooru、Muah AI Cards、Chara Cards、Pygmalion Chat、手机酒馆AI 精选角色卡、CharacterCard.com；
- 仓库与归档：Bronya Rand Archive、Hugging Face ST Repos、Cardbox Archive、Character Archive Catbox；
- 静态目录：Chatbots Webring、Neocities Creator Sources、MLPCHAG Ponydex、Anchorhold /AICG Feed、AICG Rentry Events、Rentry Tavern Export、AICG Rentry Directory、Blobfish23 Neocities、Malliebots、Snombler Neocities。

实现约束：

- provider 只接入固定资源站，不提供任意 URL 代理；
- 下载和导入由对应 provider 校验资源 ID 与文件结构；
- GitHub、Chub、RisuRealm 和 Botbooru 的可选凭据沿用 `secrets.json`，前端只读取遮罩状态；
- 导入来源记录写入用户目录下的 `remote-resources/imports.json`；
- 外部服务的可用性由请求结果和外部依赖测试确认，不在静态文档中承诺长期在线。

## 本地安装与启动

要求：

- Node.js 22.19 或更新版本；
- npm；
- Git。

安装应用与测试依赖：

```text
npm install
npm --prefix tests install
```

启动本地服务：

```text
npm run start -- --port 8011 --browserLaunchEnabled=false
```

访问：

- `http://127.0.0.1:8011/`；
- `http://127.0.0.1:8011/modern/`。

两个入口都应进入新版界面。

## 更新项目

本仓库只维护 `master`。更新前确认分支和工作区状态：

```text
git branch --show-current
git status --short --branch
```

只在当前分支为 `master`、本地改动已经妥善保存且提交范围清楚时继续。重要用户数据应先备份；默认用户目录是 `data/default-user`。

工作区干净且本地没有未推送提交时，执行安全的快进更新：

```text
git fetch origin
git pull --ff-only origin master
npm install
```

开发环境同时更新测试依赖：

```text
npm --prefix tests install
```

Windows 用户也可以在确认当前分支是 `master` 后运行 `UpdateAndStart.bat`。该脚本会拉取当前跟踪分支、安装生产依赖并启动服务。

用户数据保留在配置的数据根目录中。不要用旧安装的整个 `public/` 或 `default/` 覆盖新 checkout；用户 CSS 的当前位置见 [public/css/!USER-CSS-README.md](public/css/!USER-CSS-README.md)。

如果更新出现冲突，先检查：

```text
git status
git diff
```

不要使用 `git reset --hard`、删除工作区或覆盖不属于本次更新的本地改动。分支出现 ahead/behind 分叉时应停止并确认同步方案。

## 验证

所有改动至少执行：

```text
git diff --check
```

JavaScript 改动执行：

```text
npm run lint
```

检查 `public/modern` JavaScript 语法。

PowerShell：

```powershell
Get-ChildItem public/modern -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

POSIX shell：

```sh
find public/modern -name '*.js' -print0 | xargs -0 -n 1 node --check
```

运行类型检查和单元测试：

```text
npm run typecheck:modern
npm run test:unit --prefix tests
```

运行全部 Modern E2E。

PowerShell：

```powershell
$env:PWDEBUG = '0'
$env:PLAYWRIGHT_HTML_OPEN = 'never'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:8011'
.\tests\node_modules\.bin\playwright.cmd test "tests/modern-.*\.e2e\.js" --config=tests/playwright.config.js --workers=1 --reporter=list
```

POSIX shell：

```sh
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 \
./tests/node_modules/.bin/playwright test 'tests/modern-.*\.e2e\.js' --config=tests/playwright.config.js --workers=1 --reporter=list
```

只运行真实后端集成时，把测试参数替换为 `modern-real-backend-integration.e2e.js`。

多个 Playwright 运行同时进行时，用 `PLAYWRIGHT_MOCK_PORT` 给每个运行单独的模拟服务器端口和输出目录，详见 [tests/README.md](tests/README.md)。

外部依赖测试默认跳过。需要验证公网下载、真实扩展仓库或供应商 API 时，显式设置：

- `MODERN_EXTERNAL_E2E=1`；
- `MODERN_EXTERNAL_OPENROUTER_API_KEY` 和 `MODERN_EXTERNAL_OPENROUTER_MODEL`，仅在供应商 smoke 需要时设置；
- 其他可选 URL、扩展仓库和期望值变量，以 `tests/modern-external-dependencies.e2e.js` 为准。

密钥只通过环境变量或应用密钥存储传入，禁止写入命令示例、测试文件或 Git。

## 开发与维护

- [AGENTS.md](AGENTS.md)：当前工作区和分支操作的权威硬约束；
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献和验证流程；
- [MODERN_UI_ARCHITECTURE.md](MODERN_UI_ARCHITECTURE.md)：Modern Workspace 架构基线；
- [SECURITY.md](SECURITY.md)：安全问题范围与报告方式。

## 后端接口日志

启用 `logging.enableAccessLog` 后，接口访问和错误日志默认写入 `<DATA_ROOT>/backend-logs`。`logging.accessLogRoot` 可以覆盖为绝对路径。

日志按本地日期保存：

- `backend-logs/YYYY-MM-DD/access.log`；
- `backend-logs/YYYY-MM-DD/error.log`。

访问日志包含 request ID、方法、路径、状态码、耗时、IP、User-Agent 和可用的用户标识；错误日志包含请求内警告/错误、未捕获接口错误和 5xx 响应。可使用 request ID 关联两类日志。服务启动时会清理超过一周的日期目录。

## 上游资源

- GitHub：<https://github.com/SillyTavern/SillyTavern>
- 文档：<https://docs.sillytavern.app/>
- Discord：<https://discord.gg/sillytavern>
- Reddit：<https://reddit.com/r/SillyTavernAI>

上游资料用于未改变能力的参考；本仓库的入口、分支、Modern Workspace 和验证规则以当前 checkout 内文档为准。

## License

AGPL-3.0
