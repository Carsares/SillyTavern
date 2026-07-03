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
find public/modern -name '*.js' -print0 | xargs -0 node --check ; echo EXIT=$?
nice -n 19 npm run lint ; echo EXIT=$?
git diff --check ; echo EXIT=$?
```

运行 modern E2E 时固定使用 headless/list reporter，不打开可视浏览器或 HTML report：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-*.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

只跑真实后端集成覆盖：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-real-backend-integration.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

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

## License

AGPL-3.0
