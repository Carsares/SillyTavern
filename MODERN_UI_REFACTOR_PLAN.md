# Modern UI Refactor Plan

## 目标

将 `/modern/` 建成 SillyTavern 的用户可见主界面。用户日常使用到的页面、入口和交互都应在新版现代化界面内完成，不再跳回旧版 `/` 页面。

本次改造不是重写 SillyTavern 底层逻辑，也不是一次性 100% 等价替代旧版所有深层能力。目标边界是：用户可见交互现代化；底层后端接口、数据结构、隐藏 bridge/iframe 能力可以继续复用旧版。

## 硬约束

1. `/modern/` 是用户可见主界面，常规用户入口不应跳回旧版 `/`。
2. 删除或隐藏所有常规“打开原版”“打开旧版”入口，包括侧栏、顶部栏和各功能页内的旧版跳转按钮。
3. 原本依赖旧版页面承接的功能，要在新版中用现代化页面、面板、抽屉、只读信息区或浅编辑区承接。
4. 暂时无法安全编辑的高级项可以只读展示或标注状态，但不能把用户带回旧版页面。
5. 可以复用旧版后端接口、旧版数据结构和隐藏 `legacy bridge`/`iframe`，这类内部实现不是用户可见页面。
6. API 页中类似“请打开原版配置”的文案和路径要改为新版内说明、只读状态或浅编辑承接。
7. 改造应尽量保持现有核心交互逻辑不变，优先做表层现代化、模块拆分和用户可见能力补齐。
8. 不为了少数极端情况引入复杂双链路、降级或临时补丁；外部可见契约保持稳定。
9. 每个改造点按可验证的小提交推进，提交前至少跑语法检查、lint、diff check 和相关 Playwright 回归。

## 当前状态

已完成：

- 新版入口 `/modern/` 已覆盖工作台、聊天、角色、群组、世界书、预设、人设、素材、API、扩展、活动、设置等用户可见页面；根路径 `/` 已重定向到 `/modern/`，并保留查询参数。
- 常规用户可见旧版入口已移除，并有 E2E 覆盖“不暴露旧版导航”。
- API 页已改成新版内连接中心，聊天补全连接可编辑，文本补全已支持来源、端点、模型、预设、采样、密钥状态和连接测试等浅编辑能力。
- 素材页已支持背景分页加载、选择模式、批量删除、文件夹管理、素材下载和资产分组展开。
- 世界书页已支持条目搜索、分页、排序、多选、批量启停、批量删除和高级字段编辑。
- 预设页已支持集中浏览、选择、复制、保存 JSON、删除。
- 扩展页已支持扩展详情、安装、更新、移动、删除和分支切换入口。
- 设置页已支持现代界面偏好、请求压缩配置、设置快照预览和恢复。
- 角色、群组、人设、素材、预设、API、扩展、设置、世界书、聊天上下文、聊天文件、聊天消息和生成动作已从 `public/modern/app.js` 拆出。
- `public/modern/styles.css` 已拆成 `base.css`、`shell.css`、`components.css`、`layout.css`、`overlays.css`、`responsive.css` 和各 route 样式文件。
- Playwright 覆盖已扩展到角色、群组、人设、素材、API、扩展、设置、聊天文件、dashboard/activity、inspector、世界书等 modern 用户流程。

仍需重点处理：

- `public/modern/app.js` 当前主要承担依赖注入、状态装配和全局编排，仍可继续拆出启动/依赖装配层，但不再是聊天动作集中点。
- 若继续模块化，优先处理仍偏大的 action 和事件文件，例如 `actions/worldbooks.js`、`actions/characters.js`、`actions/presets.js`、`actions/chat-files.js`、`actions/chat-context.js`、`actions/assets.js`。
- CSS 已完成按 route 拆分，后续只需围绕真实冲突继续细拆 `components.css` 和 `routes/chat.css`，不再按“拆单体 styles.css”推进。
- 聊天页仍有体验打磨空间，重点是视觉层级、移动端抽屉、消息操作降噪、生成状态和文件/备份管理入口的聚合。
- Dashboard、Activity、Inspector 已产品化一轮，后续增强应基于具体可操作场景继续补筛选、跳转和诊断信息。

## 待改造范围

### 1. App 启动编排继续收口

`public/modern/app.js` 已不再承载主要业务动作，但仍集中创建 actions、route handlers、shell、inspector 和全局刷新流程。

后续可拆：

- `public/modern/bootstrap/actions.js`：集中创建 action bundle。
- `public/modern/bootstrap/routes.js`：集中创建 route handlers 和事件绑定。
- `public/modern/bootstrap/shell.js`：集中创建导航、命令面板、搜索、inspector 和通知。

原则：只移动启动装配代码，不改变状态结构、事件流和用户可见行为。

### 2. 大 action 模块继续拆分

这些文件仍偏大，适合按领域数据和行为继续拆：

- `public/modern/actions/worldbooks.js`
  - 世界书列表/选择
  - 条目 CRUD
  - 批量启停/删除
  - 高级字段保存
- `public/modern/actions/characters.js`
  - 角色创建/编辑
  - 头像导入/替换
  - 标签与详情字段整理
- `public/modern/actions/presets.js`
  - 预设浏览/选择
  - JSON 编辑/保存
  - 复制/删除
- `public/modern/actions/chat-files.js`
  - 聊天文件 CRUD
  - 导入/导出
  - 备份读取/恢复/删除
- `public/modern/actions/chat-context.js`
  - 当前聊天对象选择
  - 消息加载与分页
  - 草稿、搜索和上下文状态
- `public/modern/actions/assets.js`
  - 背景文件夹
  - 素材选择/下载/删除
  - 分组展开和筛选

原则：按已有职责边界拆出内部 helper 或子 action，不新增双链路，不改变 API payload、错误处理和本地状态字段。

### 3. Chat 体验优化

聊天页已完成基础 modern 承接和行为测试，后续重点不是“补旧版入口”，而是整理现代聊天体验。

建议：

- 桌面端保留清晰的会话/对象选择区，移动端使用覆盖式抽屉，避免挤压聊天区。
- 消息常用操作直接可见，危险或低频操作收进确认面板或管理区。
- 生成状态、停止生成、swipe、继续生成等能力集中到聊天上下文内，减少主视野噪音。
- 导入、导出、备份、恢复等文件管理能力聚合到工具面板。
- 空状态、加载状态、错误状态保持在聊天语境内展示，不跳旧版页面。

### 4. 样式继续细分

CSS 单体拆分已完成。后续只有在继续 UI 并行改造或文件冲突明显时，再做更细粒度拆分。

优先候选：

- `public/modern/styles/components.css`
- `public/modern/styles/routes/chat.css`
- `public/modern/styles/shell.css`

原则：只移动样式归属，不顺手改视觉；视觉优化单独提交。

### 5. Dashboard、Activity、Inspector 增强

这三块已经具备 modern 形态和基础 E2E，后续增强要绑定真实用户路径。

建议：

- 工作台卡片继续补直接跳转和异常处理入口。
- 最近聊天、角色、群组、世界书、素材摘要继续补对象级跳转。
- 活动页补筛选、排序和按对象跳转。
- Inspector 按当前 route 展示诊断信息、选中对象、批量操作状态和最近错误。

### 6. E2E 覆盖维护

当前 modern E2E 已覆盖主要用户流程，后续测试不再以“补页面打开”为主，而是跟随具体改造点补行为回归。

新增测试原则：

- 拆启动编排或 action 模块时，优先跑对应 route 的既有 E2E 和 `modern-workspace.e2e.js`。
- 改聊天体验时，覆盖桌面和移动端关键布局、消息操作、生成状态、文件管理入口。
- 改 API、世界书、素材等业务动作时，覆盖最终请求 payload 和用户可见状态。
- 只改文档或纯样式移动时，可说明不跑 Playwright 的原因，并至少执行 `git diff --check`。

## 建议执行顺序

1. 拆 `public/modern/app.js` 的启动装配层，只搬迁 wiring，不改行为。
2. 按业务域继续拆大 action 模块，优先 `worldbooks`、`characters`、`presets`、`chat-files`、`chat-context`、`assets`。
3. 做聊天页体验优化，先定布局和交互验收，再分提交实现。
4. 仅在并行冲突或维护成本明显时继续细拆 CSS。
5. 按具体用户路径增强 Dashboard、Activity、Inspector。
6. 每个改造点补对应 E2E；避免为了测试增加生产接口或复述实现细节。

## 每项提交前验证

代码或样式改动至少执行：

```bash
find public/modern -name '*.js' -print0 | xargs -0 node --check ; echo EXIT=$?
nice -n 19 npm run lint ; echo EXIT=$?
git diff --check ; echo EXIT=$?
```

Playwright/E2E 固定使用 headless/list 口径，不打开可视浏览器或 HTML report：

```bash
npm run start -- --port 8011 --browserLaunchEnabled=false
PWDEBUG=0 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 nice -n 19 ./tests/node_modules/.bin/playwright test tests/modern-*.e2e.js --config=tests/playwright.config.js --workers=1 --reporter=list ; echo EXIT=$?
```

如改动只影响单一路由，可先跑对应 `tests/modern-*.e2e.js`，再按风险决定是否跑完整 modern E2E。文档-only 改动至少执行 `git diff --check`，并在交付说明里明确未跑 Playwright 的原因。
