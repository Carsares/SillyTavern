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
- 远程资源：独立聚合官方内容索引、GitHub/GitLab 扩展搜索、RisuRealm、Chub/CharacterHub、Character Tavern、AICharacterCards、LoreBary、WyvernChat、Mnemo、SpicyChat、Backyard AI、DataCat、Botbooru、Chatbots Webring、CharacterCard.com、Neocities Creator Sources、MLPCHAG Ponydex、Anchorhold /AICG Feed、Cardbox Archive、AICG Rentry Events、Rentry Tavern Export、AICG Rentry Directory、Character Archive Catbox 和 Blobfish23 Neocities 搜索，支持远程搜索、下载/导入、扩展安装、URL 导入、导入记录和资源站凭据保存状态。
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
- 匿名 provider 默认可用；GitHub token、Chub cookie、RisuRealm token、Botbooru token 通过现有 `secrets.json` 保存，前端只显示遮罩状态。
- 导入后的来源关系写入用户目录下的 `remote-resources/imports.json`，不污染角色卡、世界书或扩展自身文件。
- Chub 搜索不直接从 Node 请求 `ro.chub.ai/search`，而是每次 Chub 搜索自动拉起一个独立的后台 headless Chrome/CDP 打开搜索页，读取前端实际消费的 JSON 响应，并在调用完成后关闭进程；登录态通过 Chub cookie 或 `SILLYTAVERN_CHUB_CDP_PROFILE` 指向的持久 profile 目录保留。
- JannyAI 搜索使用公开 Meilisearch 角色索引，下载时读取匿名详情页里的 SSR 角色字段并转换为 SillyTavern 角色 JSON。
- Character Tavern 搜索使用 `character-tavern.com/api/search/cards`，下载时读取 `api/character/:author/:name` 并转换为 SillyTavern 角色 JSON。
- AICharacterCards 搜索使用 `api.aicharactercards.com/api/cards`，下载通过 `/cards/:id/versions` 获取当前 PNG 角色卡。
- LoreBary 搜索使用 `/api/lorebook/public` 和 `/api/plugin`，世界书可导入，LoreBary plugin 作为 `preset` 类型下载，不当作 SillyTavern 扩展安装。
- Bronya Rand Archive 搜索读取静态 `world-lore-books` 索引，只允许下载归档内 `world-info/**/*.json` 世界书。
- WyvernChat 搜索使用 `/api/characters/public` 和 `/api/lorebooks/public`，角色下载读取 `/api/characters/:id` 并转换为 SillyTavern 角色 JSON，世界书下载读取 `/api/lorebooks/:id` 并转换为 SillyTavern 世界书 JSON。
- Mnemo 搜索使用公开 Supabase SFW `characters` 索引，角色下载优先读取原始 PNG/JSON 文件；当前未暴露为空的 `lorebooks` 表作为世界书搜索源。
- SpicyChat 搜索先读取 `/v2/applications/spicychat` 下发的公开 Typesense 配置，再查询 SFW 且定义公开的 `public_characters_alias` 角色索引；角色下载读取 `/v2/characters/:id` 并转换为 SillyTavern JSON。Lorebook 页面匿名 403，公开 `lorebooks_public` 索引当前为空，暂不接入世界书。
- Backyard AI 搜索使用 Community Hub 的匿名 tRPC 接口 `hub.browse.getHubGroupConfigsBySearch`，空搜索读取 `getHubGroupConfigsBySortType` 的 Trending 列表；角色下载读取 `getHubCharacterConfigById` 并转换为 SillyTavern JSON，详情中的 `LorebookItems` 会保留到角色卡内嵌 `character_book`，当前没有独立世界书公开目录。
- DataCat 搜索先通过 `/api/liberator/identify` 创建匿名 session，再调用 `/api/characters/recent-public` 搜索 JanitorAI/JannyAI 聚合角色；下载读取 `/api/characters/:id/download` 返回的 SillyTavern `chara_card_v2` JSON。DataCat 结果会显式标记 NSFW。
- Botbooru 搜索使用匿名 `/posts/` 角色列表和 `/api/lorebooks` 世界书列表，默认附加 `sfw_only=true`；角色下载使用 `/download/png/:id` 保留 PNG 角色卡，世界书下载使用 `/api/lorebooks/:number/download.json`。Botbooru token 槽位仅预留给后续登录态扩展。
- Hugging Face ST Repos 搜索已验证的公开 SillyTavern 资源仓库文件树，只返回角色卡、世界书和预设 JSON；世界书源包含 `sphiratrioth666/Lorebooks_as_ACTIVE_scenario_and_character_guidance_tool` 和 `sphiratrioth666/GM-5_Game_Mistress_Roleplaying_System` 的 `01. WORLD LOREBOOKS/` 目录。
- Chatbots Webring 搜索 `chatbots.neocities.org` 静态成员站点，只抓取成员页和明确资源子页里的角色卡/世界书/预设文件、`/JSONs/` 预设 JSON、`/lorebooks/` 世界书 JSON，以及成员页明确引用的 Catbox / Chub CDN PNG 角色卡。
- Neocities Creator Sources 只抓取固定验证过的独立创作者页：Kylaci 的 Chub CDN PNG 角色卡、Graystone Universe 的世界书 JSON、LeafCanFly 的同源 SillyTavern 预设 JSON、Akiri 的 `ST_Settings/*.json` 上下文模板和采样预设、The Luminarium 的 `Cards/*.png` 角色卡 / 已验证世界书 / 预设 JSON、Kintsugi 的主预设 JSON、Momoura 的预设 JSON 和 Japari Library 世界书、Ratlover 的 `cards/*.png` 角色卡；下载前会回读来源页确认直链仍公开存在。
- Malliebots 搜索 `malliebots.neocities.org/cardsData.json` 公开索引，只接入明确带 `SFW` 且不含 NSFW/NSFL/非自愿等阻断标签的 PNG 角色卡；下载时校验 PNG 内 `chara`/`ccv3` 元数据。
- Muah AI Cards 搜索 `card.muah.ai` WordPress REST 帖子接口，并下载帖子 featured media 的 PNG 角色卡。
- Chara Cards 搜索 `edge-api.chara.cards/api/bot/search` 公开角色接口，下载时读取 `/bot/:id/public` 并转换为 SillyTavern 角色 JSON。
- Pygmalion Chat 搜索公开 Connect JSON 角色卡接口，下载时读取公开详情并转换为 SillyTavern 角色 JSON。
- 手机酒馆AI 精选角色卡解析首页静态 `characterCardsConfig`，只返回并下载带 `chara`/`ccv3` 元数据的 PNG 角色卡。
- CharacterCard.com 搜索公开 `/download` 分页里的 Next/RSC 角色列表，缓存后本地过滤关键词；下载时读取 `card.charactercard.com/card/**/*.png` 原始 PNG 并校验 `chara`/`ccv3` 元数据。
- MLPCHAG Ponydex 搜索 `mlpchag.neocities.org` 静态 manifest：`/mares.json`、`/forks.json` 和 `/chub.json` 对应 PNG 角色卡，`/lorebooks.json` 对应 JSON 世界书；下载前会校验角色卡 PNG 元数据或世界书 entries 结构，跳过 zip 与 consult-only 条目。
- Anchorhold /AICG Feed 搜索 `partyintheanchorhold.neocities.org/config.json` 和 `feed/page_*.html` 静态分页，只返回 Catbox、Chub CDN、File Garden 或 Neocities `/cards/` PNG 角色卡直链；下载时校验 PNG 内 `chara`/`ccv3` 元数据，不把帖子里的普通链接当作资源。
- Cardbox Archive 搜索 `archive.cardbox.moe/?q=...` 服务端渲染结果页，匿名聚合 Chub、Botbooru、Character Tavern、Wyvern、Risu Realm、Janitor 和 Other 来源角色卡；下载时使用搜索结果里的签名 `/card/...?...` 详情链接解析最新 `/download/.../json`，返回标准 `chara_card_v2` JSON。Cardbox 当前是角色卡归档，页面的 `Lorebook` 过滤表示角色卡内嵌 lorebook，不作为独立世界书源接入。
- AICG Rentry Events 搜索固定活动页 `aicgweeklytheme`、`botmakersecretsanta3`、`secretvalentines2026public`、`secretvalentines2026private`、`aicgwhiteday2026` 的 Rentry 表格，只读取 `Card`/`Link(s)`/`Links`/`Bots` 资源列里的 `files.catbox.moe/*.png` 候选；下载时校验 PNG 内 `chara`/`ccv3` 元数据，不把活动请求文本里的参考图、GIF 预览或 zip 包当作资源。
- Rentry Tavern Export 搜索 `rentry.org/tavern_export` 的旧 Booru.plus TavernAI 导出镜像，索引页直接解析 `Name`、`Author`、`Keywords`、`Rentry` 元信息；下载时进入单卡 Rentry 页读取 `files.catbox.moe/*.png`，并校验 PNG 内 `chara`/`ccv3` 元数据。
- AICG Rentry Directory 搜索 `aicg.neocities.org/bots` 指向的 `rentry.org/charcardrentrylist` 中心表格，直接解析 Botmaker、Category、New Bots/Updated Bots 里的 `files.catbox.moe/*.png` 角色卡链接；下载时校验 PNG 内 `chara`/`ccv3` 元数据，不把专题 Rentry 里的普通图片当作资源。
- Character Archive Catbox 搜索 `chararc.bernkastel.pictures/api/archive/v3/search/query`，固定附加 `source:generic sourceSpecific:catbox type:character` 过滤；下载时读取 `/api/archive/v1/generic/node/character/:id` 的 `metadata.source_url`，只允许原始 Catbox PNG，并校验 PNG 内 `chara`/`ccv3` 元数据。归档自身 `/image/...` PNG 只是预览图，不作为导入文件。
- Blobfish23 Neocities 搜索 `blobfish23.neocities.org` 首页中的 `bot-card` 资源块，角色卡读取 Catbox PNG，世界书读取 Catbox JSON；下载前回读首页确认直链仍公开存在，角色卡校验 `chara`/`ccv3`，世界书校验 `entries` 结构。
- GitLab 扩展搜索使用 GitLab 公开 Projects API，只返回可安装 Git URL。

暂未单独接入的已探测站点：

- Agnai：源码里的公开市场入口实际转向 Chub，站内角色库接口需要登录态；当前没有独立于 Chub/Chara Cards 的匿名公开资源源。
- JanitorAI：匿名页面和 CDP 打开均停在 Cloudflare Turnstile 人机验证，未观察到稳定的公开搜索/详情接口；不做验证码绕过。
- CharaVault：站点文档声明 `/api/cards`、`/api/lorebooks` 等匿名 API，但当前环境下 Node 直连和 Chrome/CDP 均返回 `Access Denied`；暂不默认接入，避免每次搜索稳定报错。
- Card Quest Market：搜索引擎仍有 `cardmarket.lucymm.net` 的历史列表和详情页，但当前直连列表、详情和根路径都会 301 到 MiniTavern Android GitHub；暂不作为稳定资源源接入。
- BotPrompts：旧教程仍引用 `botprompts.net` 和 `/aicg/` 直链 JSON，但当前直连会协议错误或返回反爬跳转壳；Chrome/CDP 完成跳转后进入广告停放页，不再是可枚举角色卡资源源。
- Booru.plus：旧 Pygmalion 教程仍引用 `booru.plus/+pygmalion`，但当前域名没有可用 A 记录，无法作为在线资源站接入。
- 旧 Character Archive：`char-archive.evulid.cc` 当前只保留停服页和 202GB final torrent / archive.org 源码归档说明，没有在线搜索或轻量单卡下载接口；不适合作为远程在线搜索源。当前接入的是仍在线的 `chararc.bernkastel.pictures` generic/catbox 子集。
- Chub legacy Booru：`booru.chub.ai` 仍可打开旧 Chub UI，但前端调用的是 Chub gateway/search，资源范围与现有 Chub/CharacterHub provider 重叠；不单独新增 provider。
- Charhub.ai：Node 直连被 Cloudflare 403，Chrome/CDP 可打开公开角色列表并通过 `query` 参数搜索；详情页只暴露公开简介、标签、图片和匿名会话开场，`.json` 返回 500，`/download`、`/export`、`/api/*` 候选路径返回 404，未发现匿名完整卡片定义或 SillyTavern 导出接口；暂不接入，避免只能搜索不能下载管理。
- TavernAI：公开页面、下载页和候选 `/api/*` 路径直连均返回 Cloudflare 403；使用本机 headless Chrome/CDP 打开也停在 Cloudflare 阻断页，未观察到可复用资源接口。
- HoneyChat：公开 `/en/feed` 只暴露营销目录字段；真实 `/api/feed` 需要 Telegram WebApp `x-init-data`，没有匿名可导出的 SillyTavern 卡片接口。
- CharaSnap：站点是纯前端角色卡编辑器，能本地读写 `chara`/`ccv3` PNG，但没有公开远程卡片目录或搜索接口，暂不作为资源站接入。
- GitHub 通用卡片搜索：匿名 GitHub Code Search 当前容易触发 rate limit；Repository Search 能用但多返回编辑器/管理器/生成器，不稳定证明其为资源仓库。现阶段只保留 GitHub 扩展搜索和已验证 HF 资源仓库，后续可在 GitHub token 下做增强索引。
- Hugging Face `AUTOMATIC/jaicards`：确实是 v2 角色卡档案，但资源以 20GB+ 分片 ZIP 和 200MB+ 7z 发布，匿名轻量搜索无法稳定枚举单卡；暂不接入为在线搜索源。
- MegaNova / CharacterMuse AI / Character Card Converter：当前公开页面分别是文档、生成器或本地转换器，不提供匿名可枚举的角色卡/世界书目录。
- TavernSprite：`/characters/` 是角色原型与写作分类页，博客页是指南内容；未发现匿名可下载的 SillyTavern PNG/JSON 角色卡或世界书目录。

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
- Botbooru：只勾选 Botbooru，角色卡搜索 `cat` 确认可下载 PNG；世界书搜索 `magic` 确认可下载 JSON；资源站账号页确认 Botbooru token 槽位可见。
- Cardbox Archive：只勾选 Cardbox Archive，角色卡搜索 `cat`，确认出现 Cardbox 聚合结果并可导入标准 JSON；搜索结果 ID 必须保留带 `t=` 的签名详情链接。
- AICG Rentry Events：只勾选 AICG Rentry Events，角色卡搜索 `Celeste`，确认出现 White Day 2026 的 Catbox 结果并可导入 PNG 角色卡。
- Rentry Tavern Export：只勾选 Rentry Tavern Export，角色卡搜索 `Loopi`，确认出现旧 Booru 镜像结果并可导入 Catbox PNG 角色卡。
- AICG Rentry Directory：只勾选 AICG Rentry Directory，角色卡搜索 `Drasna`，确认出现 Character Cards Rentry List 结果并可导入 Catbox PNG 角色卡。
- Character Archive Catbox：只勾选 Character Archive Catbox，角色卡搜索 `Drasna`，确认出现 Character Card Archive 的 generic/catbox 结果并可导入原始 Catbox PNG 角色卡。
- Blobfish23 Neocities：只勾选 Blobfish23 Neocities，角色卡搜索 `Alyona` 确认可导入 Catbox PNG；世界书搜索 `Tarkov` 确认可导入 Catbox JSON 世界书。
- Neocities Creator Sources：只勾选 Neocities Creator Sources，预设搜索 `Erato`，确认出现 Akiri `ST_Settings` JSON 并可下载。
- Neocities Creator Sources：只勾选 Neocities Creator Sources，角色卡搜索 `Rania` 确认出现 The Luminarium PNG 角色卡并可导入；世界书搜索 `Comet` 确认出现 The Luminarium 世界书并可导入；预设搜索 `Kintsugi` 确认只出现主预设 JSON 并可下载。
- Neocities Creator Sources：只勾选 Neocities Creator Sources，预设搜索 `neoVORPUS` 确认出现 Momoura 预设并可下载；世界书搜索 `Japari` 确认出现 Momoura Japari Library 世界书并可导入。
- Neocities Creator Sources：只勾选 Neocities Creator Sources，角色卡搜索 `Amber` 确认出现 Ratlover PNG 角色卡并可导入。
- Malliebots：只勾选 Malliebots，角色卡搜索 `Sylvie` 确认出现 SFW Malliebots PNG 角色卡并可导入。
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
