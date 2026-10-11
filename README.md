# Conversation v1

本项目提供独立的角色对话系统。`npm start` 启动 `src/conversation/server.js`，根路径进入 `/modern/conversation/`。服务端负责生成、工具、记忆和持久化，浏览器只负责交互与事件恢复。

## 安装与启动

要求 Node.js 22.19 或更新版本。执行：

```sh
npm ci
npm start
```

默认监听 `127.0.0.1:8000`，数据写入 `data/default-user/conversation-v1/`。可用 `node server.js --port 8001 --dataRoot /absolute/new-data` 更换端口和数据根目录。数据根目录下仍使用 `default-user/conversation-v1`。

远程监听需设置 `CONVERSATION_PASSWORD`，并通过 `--host` 和 `--allowed-host` 明确配置监听地址及浏览器访问的主机名。界面使用 HTTP Basic 密码认证；对外部署请在受信任的 HTTPS 反向代理之后运行。默认本机访问无需密码。写接口同时校验同源请求与请求安全令牌。

## 首次使用

打开“资源”创建连接、角色、用户人设、预设、世界书或群组。在连接内设置执行器、服务商、模型、上下文窗口、输入/输出上限和工作预算。凭据仅在服务端保存。

新建会话并在设置里选择资源。先检查连接能力，再发送消息。默认原生执行器采用 pi 的模型与工具循环；Claude Agent SDK 和 Codex SDK 使用统一适配层及本地请求网关。

记忆页提供摘要、结构化记忆、锁定和压缩；诊断页提供编译上下文、来源、请求轨迹和用量；维护页提供备份、恢复、检索重建和清理预览。每项能力的可用性取决于连接与平台声明，真实服务商验证状态须单独查看。

## 架构与约束

- [架构与模块边界](docs/conversation/ARCHITECTURE.md)
- [协议契约](docs/conversation/CONTRACTS.md)
- [运行、恢复与维护](docs/conversation/OPERATIONS.md)
- [实施和提交阶段](docs/conversation/IMPLEMENTATION.md)
- [验收证据与剩余限制](docs/conversation/VALIDATION.md)
- [长对话评测](tests/conversation/evaluation/README.md)

新数据库是对话事实的唯一持久化来源。消息版本、候选、快照、事件、资源版本与工具记录分别持久化。同一对话最多一个活动轮次；模型调用期间不持有数据库事务。

这是新数据格式。入口不读取旧配置或旧聊天目录，也不执行迁移、隐藏页面或旧生成桥接。仓库保留的旧源码和旧架构文档仅供历史查阅。

## 验证

开发阶段只执行相关模块单测，按阶段提交。所有功能代码就绪后才运行集成、故障与浏览器验证。真实调用和长对话质量评测必须配置连接并明确费用上限；模拟结果不能代表真实质量或平台验收。

```sh
npm run lint:conversation
npm run test:conversation:unit
npm run test:conversation:integration
```

测试使用临时目录和模拟服务商，不读取真实用户数据。已执行检查和未验证限制记录在实施状态文档中。
