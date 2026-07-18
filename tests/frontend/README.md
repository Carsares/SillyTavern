# tests/frontend — 失养套件（unmaintained）

本目录下的套件（`Macro*` 系列等）继承自上游，**假设根路由 `/` 直达 legacy 页面**（点 `#userList`、等根 URL、相对路径 `import './scripts/...'`）。

本 fork 已将 `/` 302 重定向到 `/modern/`（旧版软下线），这些用例与当前入口行为不兼容，**已实际掉出维护范围**。

处置（遵循软下线"不删文件"原则）：

- 这些文件**只从执行入口排除**（见 `tests/playwright.config.js` 的 `testIgnore` / projects 配置），**不删除**。
- 不修复、不迁移到 modern；MacroEngine 等运行时逻辑若需回归验证，走 modern 侧对应链路的 e2e。
- 若将来需要清理，属目录结构变更，需单独决策。

维护中的测试见 `tests/modern-*.e2e.js`（route/shell/action/真后端/外部依赖分层）与 `tests/*.test.js`（Jest 单测）。
