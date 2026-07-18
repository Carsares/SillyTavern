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
    // 只读观测：读取最近一次生成的 itemized 提示词分解快照（各部分 token 与总量），不触碰任何生成状态。
    GET_ITEMIZED_PROMPT: 'getItemizedPrompt',
};

// 各链路的超时档位（毫秒）。LOAD 为 iframe 加载超时；DEFAULT 覆盖 generate/swipe 这类重生成动作。
export const BRIDGE_TIMEOUTS = {
    LOAD: 30000,
    DEFAULT: 180000,
    STATUS: 60000,
    STOP: 15000,
    EXTENSION: 60000,
};

// legacy → modern 的单向事件（不带 id、无响应）。生成期流式增量经此推送，modern 定点渲染。
// 消息形如 { source, event: STREAM_PROGRESS, text }，用 event 字段与 request/response 区分。
export const BRIDGE_EVENTS = {
    STREAM_PROGRESS: 'streamProgress',
};
