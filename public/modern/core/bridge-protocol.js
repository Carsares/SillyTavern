// legacy bridge 协议的单一来源：legacy（public/script.js 的 modernBridge 分发区）与 modern
// （core/legacy-bridge.js 及各 callLegacyBridge 调用点）双侧 import 同一份，避免 source 标识、action 名、
// 超时档位在两侧各写一份字符串而静默漂移。改协议必须双侧同步，并由 tests/modern-bridge-headless.e2e.js 契约测试护航。

// postMessage 双向消息的 source 标识；两侧据此过滤非本协议的 window message。
export const BRIDGE_SOURCE = 'sillytavern-modern-bridge';

// modern → legacy 的 action 名。legacy 分发区按此匹配，modern callLegacyBridge 按此发起。
export const BRIDGE_ACTIONS = {
    GENERATE: 'generate',
    SWIPE: 'swipe',
    STOP: 'stop',
    STATUS: 'status',
    EXTENSION_INSTALLED: 'extensionInstalled',
    EXTENSION_BRANCH_SWITCHED: 'extensionBranchSwitched',
    // 同步通道：modern 侧改动后通知 iframe 从后端重载，消除跨 frame 的陈旧快照。
    RELOAD_CHAT: 'reloadChat',
    RELOAD_CHARACTER: 'reloadCharacter',
    RELOAD_SETTINGS: 'reloadSettings',
    // payload { names?: string[], refreshList?: boolean }：清掉引擎的世界书缓存（不带 names 则全部），并默认刷新世界书名称列表。
    RELOAD_WORLDINFO: 'reloadWorldInfo',
    // 只读观测：读取最近一次生成的 itemized 提示词分解快照（各部分 token 与总量），不触碰任何生成状态。
    GET_ITEMIZED_PROMPT: 'getItemizedPrompt',
    // payload { avatar | groupId, chat, integrity?, mode: 'force' | 'auto' }：让摘要扩展（主模型或 WebLLM 来源）为这个聊天生成摘要，
    // 写进消息的 extra.memory 并立即保存。force 一定生成；auto 先按扩展自己的触发条件（间隔 / 字数 / 暂停）判断，没到点返回 { due: false }。
    // 与 GENERATE 同样排队串行，可被 STOP 中止。回复 { due, summary, index, saved, reason, ... }，来源是 Extras 或扩展被禁用时回复错误。
    // 引擎在 bridge 模式下不再自行触发摘要（见 memory/index.js），何时摘要完全由 Modern 决定。
    SUMMARIZE: 'summarize',
    // payload { avatar | groupId, chat, integrity? }：让引擎按当前设置「干跑」一次（旧版 Generate 的 dryRun，与旧版提示词管理器同一条路径）拼出下次要发的提示词，
    // 只数 token、不请求模型，用来在发送前预估用量。与 GENERATE 同样排队串行，不会和运行中的生成交错，也不改聊天文件、提示词分解记录和消息。
    // 回复 { available: true, estimated: true, mainApi, apiFriendlyName, tokenizer, modelUsed, presetName, maxContext, totalTokens, includesDraft: false }
    // 或 { available: false, reason, message? }；reason 为 group（群聊暂不支持，引擎也不会切换上下文）、no-character、unsupported-api、
    // budget（必选提示词已超出预算，message 是旧版给出的原因）、prompt-error、no-data。输入框里尚未发送的草稿不在干跑内，includesDraft 恒为 false。
    ESTIMATE_PROMPT: 'estimatePrompt',
};

// 各链路的超时档位（毫秒）。LOAD 为 iframe 加载超时；DEFAULT 覆盖 generate/swipe 这类重生成动作。
export const BRIDGE_TIMEOUTS = {
    LOAD: 30000,
    DEFAULT: 180000,
    STATUS: 60000,
    STOP: 15000,
    EXTENSION: 60000,
    // 等待引擎确认一次 RELOAD_* 的上限；超时按失败处理，但引擎侧排队的重载之后仍会执行。
    RELOAD: 30000,
    // GENERATE / SWIPE 发出前等待在途重载完成的上限；超时后照常发送（引擎侧同样会让重载先于生成执行）。
    RELOAD_WAIT: 10000,
    // SUMMARIZE 要等一次模型调用，和 GENERATE 同档。
    SUMMARIZE: 180000,
    // ESTIMATE_PROMPT 可能要排在一次生成之后，并在引擎里把整段提示词数一遍 token（非聊天补全的主 API 要逐段请求分词器）。
    ESTIMATE: 60000,
};

// legacy → modern 的单向事件（不带 id、无响应）。生成期流式增量经此推送，modern 定点渲染。
// 消息形如 { source, event: STREAM_PROGRESS, text }，用 event 字段与 request/response 区分。
export const BRIDGE_EVENTS = {
    STREAM_PROGRESS: 'streamProgress',
};
