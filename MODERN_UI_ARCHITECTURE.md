# Modern UI Architecture

## Purpose

`/modern/` is the default user-visible workspace. The root route enters it after login checks, and normal browsing, configuration, resource management, and chat workflows stay inside the Modern UI.

This layer modernizes the frontend without replacing SillyTavern's backend contracts or user-data formats. Legacy frontend resources and the hidden bridge may remain internal dependencies, but they are not normal navigation destinations.

## Invariants

1. `/` and `/modern/` enter the Modern UI while preserving relevant query parameters.
2. The Modern UI does not expose a routine “open legacy/original UI” action.
3. Existing `/api/...` payloads, responses, defaults, errors, and storage semantics remain compatible unless a change explicitly updates the contract.
4. The hidden legacy bridge is an implementation detail, primarily for existing generation behavior.
5. New user-visible capabilities are implemented in the appropriate Modern route instead of adding a second workflow.
6. External provider and public-network behavior is tested only through explicitly enabled external-dependency coverage.

## Current route surface

`public/modern/core/constants.js` defines 13 routes:

| Route ID | Responsibility |
| --- | --- |
| `dashboard` | Resource overview, recent conversations, and status entry points |
| `chat` | Character/group conversations, messages, generation, chat files, backups, chat tools, and chat search across characters |
| `characters` | Character create, edit, import, copy, rename, avatar, and delete |
| `groups` | Group create, edit, membership, and group chat entry |
| `worldbooks` | World book files, activation, entry editing, and bulk operations |
| `presets` | Preset selection, import, copy, export, restore, and delete |
| `personas` | Persona create, avatar, default selection, and delete |
| `assets` | Backgrounds, folders, uploads, downloads, rename, and delete |
| `remoteResources` | Provider search, download/import/install, credentials, and history |
| `api` | Main API configuration, secrets, models, connection tests, and request settings |
| `extensions` | Extension list, install, update, move, extension-repository branch selection, and delete |
| `activity` | Recent resource activity and object navigation |
| `settings` | Modern UI preferences, settings snapshots, chat-tool settings, and data maintenance |

The constants file is the route-list source of truth. Do not duplicate the route count in tests or code when it can be derived.

## Frontend ownership

- `public/modern/app.js`: application composition and startup only;
- `public/modern/core/`: shared state, API client, constants, utilities, and hidden bridge;
- `public/modern/shell/`: navigation, routing, loading, command palette, inspector, topbar, and render coordination;
- `public/modern/routes/`: route rendering and route-level event binding;
- `public/modern/actions/`: business actions and backend calls grouped by domain;
- `public/modern/components/`: route components and reusable UI fragments;
- `public/modern/styles/`: base, shell, layout, component, overlay, responsive, and route styles.

Keep behavior near its owning domain. Add a shared abstraction only when multiple current consumers have the same semantics.

## Backend boundaries

- Modern code calls the existing backend; it does not create a parallel modern-only backend.
- Request and response normalization belongs in the API client or owning action, not in render-only components.
- User-visible errors must retain enough backend context to diagnose the failed action. A failed `apiFetch` carries `error.status` and the first 2,000 characters of the response body as `error.body`, so callers can tell a missing key from an unreachable provider.
- Secrets remain in existing secret storage and are exposed to the browser only as state needed by the UI.
- Data migrations belong in backend startup or data-management code, not frontend fallbacks.

## Hidden engine bridge

Generation, candidate switching, chat summaries, the prompt breakdown, and the prompt-size estimate still run in the legacy page loaded in a hidden iframe (`/index.html?modernBridge=1`). The Modern UI owns every write to settings, characters, chat files, and world books; the engine only reads them. The protocol has one source of truth, `public/modern/core/bridge-protocol.js`, imported by both sides (`core/legacy-bridge.js` on the Modern side, the `handleModernBridge*` area of `public/script.js` on the engine side). Change both sides together and extend `tests/modern-bridge-headless.e2e.js`.

| Action | Payload | Reply |
| --- | --- | --- |
| `generate` | `avatar` or `groupId`, `chat`, `integrity`, `type`, `message`, `forceAvatar` | `saved`, `chat`, `messageCount`, and `stopped`, `started`, `keptReplyChars`, `removedEmptyReply` after a stop |
| `swipe` | `avatar` or `groupId`, `chat`, `integrity`, `messageIndex`, `direction` | `saved`, `swipeId`, `swipeCount`, plus the stop fields |
| `stop` | none | `stopped` |
| `status` | optional chat context | `avatar`, `groupId`, `chat`, `messageCount` |
| `reloadChat` | `avatar` or `groupId`, `chat` | `{ ok: true }` after the chat file was opened again |
| `reloadCharacter` | none | `{ ok: true }` after the character list was fetched again |
| `reloadSettings` | none | `{ ok: true }` after the generation settings were applied again (see below) |
| `reloadWorldInfo` | `names?: string[]`, `refreshList?: boolean` | `{ ok, all, names, refreshedList }` |
| `summarize` | `avatar` or `groupId`, `chat`, `integrity?`, `mode` (`'force'` or `'auto'`) | `avatar`, `groupId`, `chat`, `messageCount`, `due`, `summary`, `index`, `saved`, `reason`, `messagesSince`, `wordsSince`, and `stopped` after a stop |
| `estimatePrompt` | `avatar`, `chat`, `integrity?` (a `groupId` is answered with `reason: 'group'`) | `{ available: true, estimated: true, mainApi, apiFriendlyName, tokenizer, modelUsed, presetName, maxContext, totalTokens, includesDraft: false }`, or `{ available: false, reason, message? }` (see below; 以 `core/bridge-protocol.js` 为准) |
| `getItemizedPrompt` | `mesId?` (the latest prompt when omitted) | `{ available: false }`, or the snapshot of the last real prompt: `mesId`, `mainApi`, `apiFriendlyName`, `modelUsed`, `presetName`, `tokenizer`, `maxContext`, `totalTokens`, `parts: [{ name, tokens }]` |
| `extensionInstalled`, `extensionBranchSwitched` | see `script.js` | `{ ok: true }` |

Rules for the sync channel:

- **Reloads are awaitable.** `createBridgeReload` (`core/bridge-reload.js`) returns `reloadChat`, `reloadCharacter`, `reloadSettings`, and `reloadWorldInfo(names, { refreshList })`. Each returns a promise that settles when the engine acknowledged and never rejects: a failure, timeout (`BRIDGE_TIMEOUTS.RELOAD`), or engine error resolves to `{ ok: false, error }`. A reload is an addition to a save that already succeeded, so callers report a failed sync next to the success (`describeReloadFailure`) instead of failing the save.
- **Generation waits for them.** In-flight reloads are counted in `state.engine.settingsSyncPending`. `generate` and `swipe` call `waitForPendingReloads` (bounded by `BRIDGE_TIMEOUTS.RELOAD_WAIT`) before they are posted. The API editors await `reloadSettings` before they refresh the page state and show the toast; world book edits only start `reloadWorldInfo` (and `reloadSettings` when the global switch or a global parameter changes) and do not block, because the editor stays usable while a cold engine boots.
- **The engine serializes its state changes.** `generate`, `swipe`, `summarize`, `estimatePrompt`, every `reload*`, and a `status` call that switches chat run one at a time in arrival order (one lane, `runInModernBridgeLane` in `script.js`), so a reload never interleaves with a running generation and a reload posted before a generate finishes first. Queued `reloadSettings`, `reloadCharacter`, `reloadWorldInfo`, and identical `reloadChat` requests share one run. `stop` and the read-only actions (`getItemizedPrompt`, a `status` call without chat context) skip the queue: a stop must reach a running generation immediately, and a stop that arrives while a generate, swipe, or summarize is still queued marks it stopped.
- **Chat file revisions.** The server issues a new `chat_metadata.integrity` on every chat save and rejects a save that carries an older one. The Modern UI keeps the revision it last saw in `state.chatMetadata` and updates it after each save; `generate` and `swipe` send it as `integrity`. When the chat of that name is already open in the engine and holds another revision, the engine opens it again before it generates (a rejected earlier save does not block that). A payload without `integrity` keeps the old behavior.
- **Chat metadata writes.** Chat-level settings (author's note, pinned background, ...) are written with `updateModernChatMetadata(entity, chatId, mutate)` in `actions/chat-context.js`: it runs in the per-chat file queue, saves the chat with the changed header and the current messages, stores the issued revision, then awaits `reloadChat`. It resolves to `{ result, metadata, reload }` (`reload.ok === false` means the file was saved but the engine is not synced yet) and refuses while a generation is running.
- **Chat message writes.** `updateModernChatAndSync(entity, chatId, updateMessages)` (same file) is the message-level counterpart used by greeting switching, summary edits, and translations: it edits a copy of the messages in the file queue, saves, and registers `reloadChat` while still holding the queue, so a generation queued behind it sees the reload. It resolves to `{ result, engineSync }`; `engineSync` is not awaited inside, so the caller can refresh the page first and report `describeReloadFailure` afterwards. It does not check for a running generation: the callers that need exclusivity (greeting switching) hold the generating state themselves.
- **Summaries are Modern-led.** `summarize` runs the summary extension's `summarizeForModernBridge` (main API or WebLLM source) for the named chat, writes the result into the `extra.memory` of the message that holds the latest summary (the second-to-last message when there is none), and saves the chat file at once instead of through the extension's one-second debounce, so Modern can read the result from the file when the reply arrives (the engine saves the file here, as it does after a generation). `mode: 'force'` always summarizes; `mode: 'auto'` first applies the extension's own due check (paused, interval, word threshold) and replies `due: false` with a `reason` without calling a model when nothing is due. `reason` is empty after a write, otherwise one of `frozen`, `off`, `empty`, `too-short`, `no-prompt`, `waiting`, `nothing`, `empty-summary`, `stopped`, or `save-failed` (the engine copy is rolled back). A disabled extension, an Extras source, an unsupported WebLLM source, a summary already running, or a malformed request come back as a bridge error. The action is serialized with generation and a `stop` aborts it. In bridge mode the extension no longer registers its own automatic triggers: Modern asks for an `auto` summary after each successful, non-stopped generation (`runAutoSummaryAfterGeneration` in `actions/chat-generation.js`), and a summary failure never fails that generation. The engine restores its itemized-prompt snapshot after a summary, so the prompt breakdown still describes the last reply rather than the summary request.
- **Prompt-size estimate (`estimatePrompt`; 以 `core/bridge-protocol.js` 为准).** Payload `{ avatar, chat, integrity? }`, single character chats only. The engine opens the chat like a generation does, runs the legacy dry run (`Generate('normal', {}, true)`, the path the legacy prompt manager uses) and only counts tokens: no model request, no chat save, no `itemizedPrompts` entry, and the in-memory state the dry run touches (abort controller, `lastInContextMessageId`, variables, the macro expansion of the first message) is restored afterwards. The reply is `{ available: true, estimated: true, mainApi, apiFriendlyName, tokenizer, modelUsed, presetName, maxContext, totalTokens, includesDraft: false }`. `maxContext` is the prompt budget (context length minus response length, the value `Generate` itself uses), and `includesDraft` is always `false`: text typed in the composer but not sent is not part of the estimate. When no estimate is possible the reply is `{ available: false, reason, message? }` with `reason` one of `group` (group chats are not supported and the engine does not switch context for them), `no-character`, `unsupported-api` (AI Horde), `budget` (the mandatory prompts exceed the budget; `message` is the legacy text), `prompt-error`, or `no-data`. A request without `avatar` or `chat` comes back as a bridge error. The action runs in the same lane as generation and summaries, and its timeout `BRIDGE_TIMEOUTS.ESTIMATE` is 60 seconds.
- **What `reloadSettings` applies.** The generation-related settings subset (sampler, API, preset, power user settings) and the extension settings of `memory` (re-inserting the summary prompt with `reapplyMemorySettings`), `translate`, `connectionManager`, and `note` (the whitelist `MODERN_BRIDGE_SYNCED_EXTENSION_SETTINGS` in `script.js`), merged key by key into the existing objects. The world info settings (`world_info_settings`: scan depth, budget, recursion and the other parameters, the globally enabled worldbooks filtered to the names the engine knows, and the character extra books `charLore`) are applied by `applyModernBridgeWorldInfoSettings`, which only assigns values through `updateWorldInfoSettings`. It never calls the engine's full settings or extension loader, or `setWorldInfoSettings`, which would register listeners again.
- **World book cache.** The engine caches every world book it loads. `reloadWorldInfo` drops the named entries (all when `names` is empty) and, unless `refreshList` is `false`, reads the world book name list again. The Modern world book actions call it after creating, editing, deleting, and importing.

## Feature slots

Chat and settings features plug into shared slots, so adding one touches only its own files (a panel, its event file, its action file, and one line in the registry). The slot contracts live in the header comments of the files named below.

- **Chat tools drawer.** `components/chat-tools.js` holds the panel registry: author's note (`chat-tool-authors-note.js`), chat summary (`chat-tool-summary.js`), and chat background (`chat-tool-background.js`). A panel is `{ id, label, icon?, isAvailable(), render() }`. The "聊天工具" button in the chat header and the drawer (styled like the backup drawer, `.chat-tools-drawer`) appear only while at least one panel is available. Toggle, tab switching, and Esc are in `routes/chat-tools-events.js`; each panel's own events are in `routes/chat-tool-*-events.js` and may return `{ handleClick, handleInput, handleChange, handleKeydown, afterRender }`. Open state lives in `state.chatTools` (`open`, `tab`); every feature keeps its own state object (`chatAuthorsNote`, `chatSummary`, `chatBackground`, `connectionSwitcher`, `maintenance`, `chatTranslation`, `characterTranslation`, `chatGlobalSearch`) in `core/state.js`.
- **Chat backdrop.** `components/chat-backdrop.js` returns the HTML that `components/chat-thread.js` inserts as the first child of `.message-list-frame`; an empty string renders nothing.
- **Composer meta row.** `components/chat-composer.js` puts two items in `.composer-meta`: the connection chip (`chat-connection-chip.js`, left) and the prompt usage label (`chat-usage-label.js`, right).
- **Settings optional tabs.** `components/settings-optional-tabs.js` adds the "聊天工具" tab (sections in `settings-chat-tools.js`: translation, summary, and a reserved reasoning section whose `isAvailable()` is still `false`) and the "数据维护" tab (`settings-maintenance.js`). A tab shows only while its panel reports itself available.
- **Action registration.** `shell/feature-slot-actions.js` returns one action group per feature; the functions of all groups are merged into every route context (`createFeatureSlotRouteContext` in `shell/route-context-chat.js`), so panels and event files destructure them from `ctx`. A name that is already used by another group or by an existing route-context entry throws at startup. Its `deps` include `state`, `apiFetch`, `apiFetchResponse`, `loadData`, `render`, `showToast`, `callLegacyBridge`, `subscribeProgress`, `bridgeReload`, and the whole `actionRegistry`.
- **Test flags.** `core/test-flags.js` reads `window.__modernTestFlags` only when it exists (tests set it with `page.addInitScript`). It forces a chat tool (`chatTools`), a settings section (`settingsToolSections`), or a settings tab (`settingsTabs`) on or off, and `slotHtml` replaces the output of the `chatBackdrop` or `chatConnectionChip` slot. Normal pages never have the object, so nothing changes. It is used by `tests/modern-slots.e2e.js`.

## Chat and settings features

These features sit on the sync channel above. Behavior that differs from the legacy UI on purpose is marked as such.

- **Context length and prompt budget.** The API page edits the chat-completion context length and an unlock switch (`oai_settings.openai_max_context`, `max_context_unlocked`); text completion edits `max_context`, `amount_gen`, and `power_user.max_context_unlocked`. The per-source and per-model limits in `actions/chat-completion-limits.js` mirror the legacy `onModelChange` clamping. For sources whose real limit depends on the remote model list the limit is only a reference value (flagged `dynamic`) and the save check rejects only values above 2,000,000. Max Tokens must stay below the context length. Saving an OpenAI preset now includes both context fields. The prompt budget is context length minus response length; the context drawer labels it "提示词预算" (it used to be called "最大上下文") next to the context limit and the share used, and `chat-usage-label.js` shows "上次发送 X / 预算 Y token" under the composer (or "预估下次发送 X / 预算 Y token" while a valid `estimatePrompt` result for the chat exists). Both read cached snapshots in `state.inspector` (`itemizedPrompt` from `getItemizedPrompt`, `promptEstimate` from `estimatePrompt`), which refresh by themselves (the last-sent one shortly after a generation ends, and only once the engine is ready) and never on render.
- **Embedded world book import.** A character card's `character_book` takes part in generation only after it is imported and linked, which Modern now offers in the character detail ("导入并关联") and once after a card is imported from a file or a remote resource (the prompt shares the legacy `AlertWI_<avatar>` marker in `accountStorage`). `core/character-book.js` is a non-mutating port of the legacy `convertCharacterBook`; `actions/character-embedded-world.js` writes `/api/worldinfo/edit` (retrying with a new name after a 409) and links through `/api/characters/merge-attributes`, then calls `reloadCharacter` and `reloadWorldInfo`. Differences from legacy: an existing link name is tried first, a name clash is resolved inline ("另存为 (2) / 覆盖 / 取消"), an empty book does not count, and the card's own `character_book` is not rewritten, so an exported card keeps the author's original book.
- **Greetings.** New chats start with the card's greeting plus its alternate greetings stored as swipes of message 0 (an empty `first_mes` lets the first alternate take over; blank alternates are dropped, which legacy does not do); group chats get one random greeting per member, as in legacy. Switching is local, with no engine call, only when the chat has exactly one message, it is not a user or system message, it has more than one text candidate, and the chat header has no `tainted` marker (`canSwitchGreetingLocally` in `actions/chat-greetings.js`, the legacy pristine-greeting rule); the file is written through `updateModernChatAndSync`. Every other swipe still goes to the engine. A greeting-only chat created earlier can load the card's alternates ("载入备用开场白"), single character chats only.
- **Author's note.** The panel edits `chat_metadata.note_prompt`, `note_interval`, `note_position`, `note_depth`, and `note_role` through `updateModernChatMetadata`, shows a field that was never set with the default value (`extension_settings.note`, else the legacy constants) and a "默认" badge, and cannot save while a generation runs. The per-character notes and the default values live in `extension_settings.note`; they are saved with `/api/settings/save` followed by `reloadSettings` (the `note` whitelist entry). Character notes cannot be edited in a group chat.
- **Chat background.** The message list shows the chat-locked background (`chat_metadata.custom_background`), else the global one (`settings.background`), under an adjustable dim layer whose value and on/off switch are kept in `localStorage` (`st-modern-chat-bg-dim`, `st-modern-chat-bg-enabled`). `core/chat-background.js` accepts only relative paths under `backgrounds/` or `user/images/`; external links, `data:` URLs, and `..` segments are treated as no background. A chat-only upload goes to `user/images/<character>/` and must also be listed in `chat_metadata.chat_backgrounds`, otherwise Data Maid would delete it as unreferenced. Asset cards offer "设为全局背景" and "设为当前聊天背景"; deleting or renaming a background that is in use warns first and keeps the global and chat references consistent. Animated backgrounds are not shown when the system asks for reduced motion.
- **Chat summary.** See the `summarize` rules above. The drawer shows, edits, and clears the summary (writing the `extra.memory` of the message that holds it, so there is never a second copy, then `reloadChat`) and has a "重新摘要" button that calls `summarize` with `mode: 'force'`; a message holding the summary carries a small "摘要" badge. The summary settings (source, interval, word thresholds, prompt, injection position) are written to `extension_settings.memory` and synced with `reloadSettings`. The default source `extras` needs an Extras server that Modern never connects, so with that source neither the automatic summary nor the button works; the panel and the settings page say so and offer a switch to the main model, which is never applied silently.
- **Connection profiles.** The profiles of the legacy connection manager (`extension_settings.connectionManager`) can be applied and created from the current connection in the chip under the composer, and applied, created, and deleted (with confirmation) on the API page; the chip also lists the five most recent models of the current source (`localStorage` key `st-modern-recent-models`) for a one-click model switch. Applying follows the legacy command order (api, preset, api, api-url, model, proxy, stop strings, reply prefix, post-processing, secret) but matches names exactly; legacy fuzzy-matches presets, proxies, and models. Whatever cannot be applied is listed as skipped with the reason: text-completion presets (sampling parameters), instruct and context templates, system prompts, tokenizers, reasoning templates, and regex presets. Switching is blocked while a generation runs. It saves the settings, starts `reloadSettings` (a generation sent afterwards waits for it), rotates the secret through `/api/secrets/rotate`, and re-reads the key state to confirm the rotation, because the endpoint answers 204 for an unknown id.
- **Translation.** Translation is display-only. A message translation is stored in `extra.display_text` (reasoning in `extra.reasoning_display_text`), with the source fingerprint and the language next to it; `mes` is never changed, the view can toggle original and translation, and an edited original marks the translation stale. Only AI replies get the action. Editing a translated message now starts from the original text, which fixes the old behavior of overwriting the original with the translation. Character cards are translated field by field into the unsaved edit draft ("翻译为中文") or into a copy, with macros, HTML, and image links replaced by placeholders and restored; a field whose placeholders do not match stays untouched. The first use of each provider asks for a privacy confirmation (kept in `localStorage`, `st-modern-translate-privacy-ack`). The auto-translate mode of the legacy extension is shown read-only with a one-click switch off. `src/endpoints/translate.js` answers successes as plain text and failures as `{ error, message, detail? }` JSON, and no longer logs the source or the translated text (lengths only).
- **Chat search across characters.** `POST /api/chats/search-all` scans the chat files of all characters and groups, newest first, with six files in flight, pre-filtering raw lines before parsing JSON. A chat matches when every word of the query occurs in some message or in the file name. The query needs two characters, or one CJK character, and at most 10 words and 200 characters. Defaults: 50 chats, 3 snippets per chat, 8 seconds (at most 200, 10, and 15 seconds). When the time runs out, the client leaves, or the limit is reached, the reply carries `partial: true` with `partialReason` (`timeout`, `disconnected`, `limit`, or `error`) next to `scannedFiles`, `totalFiles`, and `elapsedMs`. Snippets come with highlight ranges, never HTML. The chat sidebar has a "当前 / 全部" scope switch (the "全部" results are grouped by character or group and open the chat directly through `data-open-chat-file`), and the command palette offers "在全部聊天中搜索" from two typed characters. Older requests are dropped by a per-search token.
- **Data maintenance.** The "数据维护" tab shows storage usage, the Data Maid report with per-category preview and confirmed deletion, duplicate greeting-only chats, settings snapshots, chat backups, and the full data export. Every step that deletes or moves user data first lists the details, then asks for a confirmation, and works from a scan token with file-identity checks, so a file changed since the scan is skipped. Duplicate greeting-only chats (left behind before Modern created its own chat file) are never deleted: they move to a quarantine folder with a manifest, and the card's `chat` pointer is repointed first when it named such a file. Backup rotation now matches only the exact series, so pruning `chat_alice_` no longer reaches `chat_alice_2_`. See `MAINTENANCE.md` for the operational details.

## Remote resources

`src/remote-resources/provider-registry.js` owns the registered provider list. Individual files under `src/remote-resources/providers/` own provider-specific search, validation, and download behavior.

Provider rules:

- use fixed, reviewed origins instead of an arbitrary proxy;
- validate resource IDs, URLs, MIME types, and file structure before import;
- keep credentials in secret storage;
- record imported source relationships separately from imported content;
- report partial provider failures without hiding successful results from other providers.

Because third-party sites change independently, documentation describes implemented behavior rather than claiming permanent availability.

## Test ownership

- `tests/modern-workspace.e2e.js`: entry, routes, shell, and absence of visible legacy navigation;
- `tests/modern-*.e2e.js`: route-focused mocked behavior;
- `tests/modern-action-helpers.e2e.js`: action helper behavior;
- `tests/modern-bridge-headless.e2e.js`: the hidden engine's protocol contract (reload actions, ordering, chat file revisions, the settings and world book reload effects, `summarize` replies and errors), run against the real legacy page;
- `tests/modern-engine-sync.e2e.js` and `tests/modern-chat-metadata.e2e.js`: the Modern side of the sync channel (awaitable reloads, generation waiting for them, world book changes reaching the engine, the automatic summary after a generation, chat metadata writes, `integrity` in generation payloads);
- `tests/modern-slots.e2e.js`: the feature slots (chat tools drawer, backdrop, connection chip, settings optional tabs), driven with `window.__modernTestFlags`;
- feature E2E files, each with its bridge stubbed by `mockBridgeFrame`: `modern-chat-authors-note.e2e.js`, `modern-chat-background.e2e.js`, `modern-chat-summary.e2e.js`, `modern-chat-connection.e2e.js`, `modern-chat-global-search.e2e.js`, `modern-data-maintenance.e2e.js`, and `modern-translation.e2e.js`; features that live inside an existing page extend that page's file instead (`modern-api.e2e.js` for context length and the engine reload after a save, `modern-inspector.e2e.js` for the prompt budget, `modern-characters.e2e.js` and `modern-remote-resources.e2e.js` for the embedded world book, `modern-chat-ui.e2e.js` and `modern-chat-files.e2e.js` for greetings, `modern-assets.e2e.js` for backgrounds);
- Jest unit tests (`tests/*.test.js`, run with `npm run test:unit --prefix tests`): pure Modern modules (`modern-chat-completion-limits`, `modern-character-book`, `modern-chat-summary`, `modern-connection-profiles`, `modern-translation`, `modern-maintenance-actions`) and the backend pieces (`chat-search-all`, `data-maid-duplicate-greetings`, `data-maid-usage`, `data-maid-safety`, `backup-rotation`, `backup-stats`, `settings-snapshots`, `translate-endpoint`);
- `tests/modern-real-backend-integration.e2e.js`: UI-to-real-backend contract paths;
- `tests/modern-external-dependencies.e2e.js`: public URLs, external Git repositories, downloads, and real provider smoke tests.

Test infrastructure: Playwright runs on its own mock server port when `PLAYWRIGHT_MOCK_PORT` is set (default 8100; 8000 is refused), with its own data root and artifact directory, so several runs can go at the same time. `mockBridgeFrame(page, { replies })` in `tests/modern-test-utils.js` replaces the hidden engine iframe, records every `{ action, payload }` the page posts, and answers from `replies`. Both are described in `tests/README.md`. Specs that stub the bridge only prove what Modern sends and how it reacts to replies; the engine side is covered by the headless bridge test.

Coverage is a maintained test property, not a permanent documentation claim. When an endpoint or workflow changes:

1. identify the user action that reaches it;
2. update the nearest route test;
3. add or update real-backend coverage when the backend contract matters;
4. use external-dependency coverage when success depends on public state;
5. verify a user-visible result rather than only observing a request.

## Change rules

- Do not expose the hidden bridge as user navigation.
- Do not add a legacy fallback to avoid completing a Modern workflow.
- Preserve API and state contracts during mechanical moves.
- Keep loading, empty, success, and error states with their owning workflow.
- Validate character and group chat behavior together when shared chat code changes.
- Validate desktop and mobile interaction when layout or overlays change.
- Add a chat or settings feature through the feature slots (panel file, event file, action group in `shell/feature-slot-actions.js`) instead of editing `chat-thread.js`, `chat-layout.js`, `chat-composer.js`, or `settings.js`.
- Every Modern write that the engine reads must be followed by the matching reload (`reloadSettings` after settings, `reloadChat` after chat file changes, `reloadCharacter` after card changes, `reloadWorldInfo` after world book changes), and the user-visible result must report a failed sync next to the successful save.
- Update `README.md` and this document when route ownership, entry behavior, provider registration, or test responsibilities change.

## Validation

Use the current commands in `README.md`. At minimum:

- every change: `git diff --check`;
- JavaScript: syntax checks and `npm run lint`; `npm run typecheck:modern` for `public/modern`;
- pure modules and backend pieces: `npm run test:unit --prefix tests` (Jest);
- route behavior: the nearest Modern E2E file;
- shared routing, state, API, chat, or backend changes: real-backend or complete Modern E2E;
- public network or supplier behavior: explicitly enabled external-dependency tests.

This document records the maintained architecture. Product ideas and unfinished work belong in issues, not in a permanent “refactor plan.”
