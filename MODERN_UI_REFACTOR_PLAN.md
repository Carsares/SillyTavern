# Modern UI Refactor Plan

## 目标

新版 `/modern/` 是 SillyTavern 的默认用户可见主界面。根路径 `/` 已进入新版入口，常规用户的页面浏览、配置、资源管理和聊天工作流都应在新版内闭环，不再通过可见按钮或文案跳回旧版页面。

本计划的边界是前端现代化和用户可见能力承接，不重写 SillyTavern 后端，不破坏既有 `/api/...` 契约，也不改变数据文件格式。旧版前端资源、后端接口和隐藏 bridge 可以继续作为内部实现依赖，但不能成为常规用户可见导航链路。

## 硬约束

1. `/` 和 `/modern/` 都应进入新版界面，并保留原查询参数语义。
2. 新版页面不得出现常规“打开原版”“打开旧版”入口。
3. 原本依赖旧版页面承接的常用能力，应在新版页面、面板、抽屉、浅编辑区或只读信息区内承接。
4. 暂时不适合深度编辑的高级能力可以只读展示，但不能把用户带回旧版页面。
5. 复用旧版后端接口时，必须保持 payload、返回结构、错误处理、默认值和本地状态语义兼容。
6. 隐藏 `legacy bridge` 只允许作为内部能力桥接，例如聊天生成引擎调用；不能暴露成用户入口。
7. 不引入双链路、降级或临时补丁来规避新版承接问题。
8. 每个改造点按小提交推进，提交前执行与改动范围匹配的验证。

## 当前基线

已完成：

- 入口语义：`src/server-main.js` 中 `/` 登录校验后重定向到 `/modern/`，`/modern`、`/modern/`、`/modern/index.html` 返回新版页面。
- 页面覆盖：新版已覆盖工作台、聊天、角色、群组、世界书、预设、人设、素材、远程资源、API、扩展、活动、设置 13 个用户可见 route。
- 旧版入口清理：modern route 有 E2E 覆盖，确认不暴露 `data-open-legacy`、“打开原版”“原版”“旧版”等可见导航。
- API 页面承接：聊天补全、文本补全、KoboldAI Classic、NovelAI、AI Horde 五种主 API 的连接配置、密钥写入、模型刷新、连接测试、请求压缩配置都在新版内完成；未知/历史 main_api 才回退到只读占位。
- 聊天承接：角色/群组聊天选择、消息加载、编辑、复制、发送、生成、导入导出、重命名、删除、备份管理都在新版内完成。
- 资源承接：角色、群组、世界书、预设、人设、背景、资产、扩展、设置快照的主要 CRUD 和文件流转都在新版内完成。
- 模块拆分：`public/modern/app.js` 已收敛为启动装配层；业务动作、route、component、shell、core 已拆到对应目录。
- 样式拆分：样式已拆为基础、shell、组件、布局、覆盖层、响应式和 route 级 CSS，不再存在需要优先拆分的单体 `styles.css`。
- 后端兼容验证：`tests/modern-real-backend-integration.e2e.js` 已覆盖新版 UI 触发的真实后端主链路；涉及公网下载或 URL 粘贴导入的 endpoint（如 `/api/content/importURL`）由默认跳过的 `tests/modern-external-dependencies.e2e.js` 覆盖。两个套件合起来构成当前 endpoint 审计口径，无缺口。
- 外部依赖验证：`tests/modern-external-dependencies.e2e.js` 已覆盖公网 URL 资产下载、URL 粘贴导入（`/api/content/importURL`）、公开 Git 扩展安装/更新/删除、OpenRouter 真实供应商 smoke；默认跳过，配置 `MODERN_EXTERNAL_E2E=1` 后进入外部依赖回归。
- E2E 基线：modern E2E 覆盖入口、路由、聊天、角色、群组、世界书、预设、人设、素材、API、扩展、活动、设置、inspector 和真实后端集成。

当前不再作为缺口处理：

- “根路径仍进入旧版”已经完成。
- “API 文本补全只读”已经完成浅编辑和连接测试。
- “styles.css 单体”已经完成拆分。
- “聊天 actions 集中在 app.js”已经完成拆分。
- “E2E 偏浅”已经补到真实后端集成覆盖。

## 当前结构

新版前端目录：

- `public/modern/index.html`：HTML shell。
- `public/modern/app.js`：状态、API client、action registry、route context、renderer 和全局事件装配。
- `public/modern/core/`：状态、API client、常量、工具和 hidden bridge。
- `public/modern/shell/`：导航、路由、数据加载、命令面板、inspector、topbar 和渲染编排。
- `public/modern/routes/`：每个 route 的页面渲染和事件绑定。
- `public/modern/actions/`：按业务域拆分的用户动作和后端请求。
- `public/modern/components/`：页面组件和共享 UI 片段。
- `public/modern/styles/`：基础、布局、shell、组件、覆盖层、响应式和 route 样式。

测试目录：

- `tests/modern-workspace.e2e.js`：入口、route 可用性、全局 shell、无旧版入口。
- `tests/modern-*.e2e.js`：各 modern route 的 mocked E2E 行为回归。
- `tests/modern-action-helpers.e2e.js`：关键 action helper 行为。
- `tests/modern-real-backend-integration.e2e.js`：从新版 UI 触发真实后端接口的端到端契约验证。

## 后续改造原则

后续不再按“继续拆到更细”作为默认目标。只有在新增能力、修改现有行为或文件职责重新变大时，才围绕真实改动点继续拆分。

必须继续保持：

- 用户入口在新版闭环。
- 后端接口契约不变。
- API 调用有真实后端集成覆盖。
- route、action、component、style 的归属清晰。
- 测试跟随逻辑归属移动。

禁止为了重构本身扩大范围：

- 不把局部 UI 改造扩成旧版前端清理。
- 不把单 route 逻辑抽成全局策略，除非当前触达范围已经有明确共享语义。
- 不把隐藏 bridge 能力暴露成用户入口。
- 不为了少量边缘路径新增 fallback、双链路或降级说明。

## 后续工作池

### 1. 新增能力时补齐新版闭环

当新增或调整用户功能时，优先落在对应 route：

- 页面结构放在 `routes/` 和 `components/`。
- 用户动作放在对应 `actions/`。
- 样式放在 route CSS 或已有共享 CSS。
- 状态字段放在 `core/state.js`，只保留真实需要跨 route 共享的状态。

验收标准：

- 用户不需要跳旧版页面完成该流程。
- 请求 payload 和后端契约保持兼容。
- 有对应 route E2E 或 real-backend E2E。

### 2. API 调用维护

任何新增 `public/modern/**/*.js` 中的 `/api/...`、`/csrf-token` 或 callback 相关调用，都必须同步检查真实后端集成覆盖。

验收标准：

- `tests/modern-real-backend-integration.e2e.js` 覆盖从 UI 触发请求到用户可见结果。
- endpoint audit 无缺口。
- 不只 mock 请求，不只验证按钮点击。

### 3. 外部依赖链路维护

真实供应商 API、公网 Git 仓库、公网 URL 下载依赖外部状态，不能混入普通本地回归直接运行，但必须有可自动执行的外部依赖回归入口。

验收标准：

- 新增或调整真实供应商调用时，补 `tests/modern-external-dependencies.e2e.js` 的供应商 smoke，使用显式密钥环境变量。
- 新增或调整扩展安装、更新、分支、删除链路时，覆盖公开 Git 仓库或等价远端仓库的真实 clone/fetch/pull 行为。
- 新增或调整 URL 下载链路时，覆盖白名单公网 URL 下载到本地文件并校验文件内容。
- 外部依赖测试默认 skip；配置 `MODERN_EXTERNAL_E2E=1` 后必须能在 headless/list Playwright 命令中自动执行。

### 4. 聊天体验增量优化

聊天页已经完成功能承接，后续优化应围绕具体体验问题推进：

- 桌面和移动端布局。
- 会话选择、文件管理、备份管理的入口密度。
- 消息操作、生成状态、停止生成、继续生成等主流程反馈。
- 空状态、加载状态、错误状态。

验收标准：

- 角色聊天和群组聊天都不回退旧版。
- 移动端不会出现内容遮挡或无法操作。
- 聊天文件和生成链路 E2E 仍通过。

### 5. Dashboard、Activity、Inspector 增强

这三块已经具备新版形态。后续只在有明确用户路径时增强：

- 工作台补直接跳转和异常处理入口。
- 活动页补筛选、排序和对象级跳转。
- Inspector 展示当前 route、选中对象、批量操作状态和最近错误。

验收标准：

- 增强信息能引导用户完成具体操作。
- 不把说明文案变成旧版入口。
- 覆盖 dashboard/activity/inspector 对应 E2E。

### 6. 旧版可见页面下线评估

旧版 `public/` 仍是上游 SillyTavern 的重要组成，包括历史页面、资源、脚本和内部 bridge 依赖。是否删除或彻底停用旧版可见页面，不属于当前默认改造范围，需要单独确认产品边界和兼容风险。

在未确认前：

- 不删除旧版文件。
- 不修改旧版深层行为来迁就新版。
- 只保证常规用户入口和新版页面不主动跳旧版。

## 验证口径

文档-only 改动：

```bash
git diff --check ; echo EXIT=$?
```

JS 代码改动：

```bash
find public/modern -name '*.js' -print0 | xargs -0 -n 1 node --check ; echo EXIT=$?
nice -n 19 npm run lint ; echo EXIT=$?
git diff --check ; echo EXIT=$?
```

启动服务：

```bash
nice -n 19 npm run start -- --port 8011 --browserLaunchEnabled=false
```

modern E2E 固定 headless/list reporter，不打开可视浏览器或 HTML report：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test "tests/modern-.*\\.e2e\\.js" --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

真实后端集成：

```bash
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-real-backend-integration.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

外部依赖真实回归：

```bash
MODERN_EXTERNAL_E2E=1 MODERN_EXTERNAL_OPENROUTER_API_KEY=... MODERN_EXTERNAL_OPENROUTER_MODEL=... PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test modern-external-dependencies.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

改动只影响单一路由时，可以先跑对应 `modern-*.e2e.js` 文件；改动影响 API 契约、状态装配、聊天主链路或入口语义时，需要跑 real-backend E2E 或完整 modern E2E。

## 当前完成标准

当前阶段的完成标准是：

- 新版作为默认用户入口。
- 常规用户可见功能在新版闭环。
- 新版 API 调用与后端契约兼容。
- 真实后端集成测试覆盖当前新版前端 endpoint 表面。
- 高风险外部依赖链路有显式可执行的外部回归入口。
- 文档不再把已完成事项列为待办。

后续工作应以具体新增功能、体验问题或维护成本为触发条件，而不是继续做无目标拆分。
