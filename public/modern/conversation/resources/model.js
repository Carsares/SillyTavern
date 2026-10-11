import { PRESET_DEFAULTS, BLOCK_DEFAULTS } from '../../../shared/conversation/assembly/defaults.js';
import { WORLD_INFO_DEFAULTS, WORLD_ENTRY_DEFAULTS } from '../../../shared/conversation/world-info/index.js';
export const EXECUTORS = Object.freeze([['pi', '原生（pi）'], ['claude', 'Claude Agent SDK'], ['codex', 'Codex SDK']]);
export function resourceDefaults(kind) {
    const defaults = {
        character: { description: '', personality: '', scenario: '' },
        persona: { description: '', personality: '', scenario: '' },
        preset: PRESET_DEFAULTS,
        worldbook: WORLD_INFO_DEFAULTS,
        group: { members: [], mode: 'sequential' },
        connection: { provider: 'openai', executor: 'pi', type: 'chat', historyMode: 'native-transcript', baseUrl: '', model: '' },
    };
    return structuredClone(defaults[kind]);
}
export const newWorldEntry = id => ({ id, ...structuredClone(WORLD_ENTRY_DEFAULTS) });
export const newPromptBlock = id => ({ id, ...structuredClone(BLOCK_DEFAULTS) });
export function historyModeDescription(capability) {
    if (capability?.historyMode === 'native-transcript') return '服务端输入模式：原生角色消息。';
    // Native primary capabilities omit type/historyMode; a supported native connection defaults to chat.
    if (!capability?.historyMode && capability?.supported === true) {
        if (capability.type === 'text') return '输入模式：文本补全（按预设模板编译历史）。';
        if (!['claude', 'codex'].includes(capability.executor) && (capability.type === 'chat'
            || capability.type == null && ['pi', 'native'].includes(capability.executor))) return '输入模式：原生聊天消息。';
    }
    return capability?.historyMode === 'structured-transcript'
        ? '输入模式：结构化转录。历史角色、工具及来源信息编码成转录内容交给 SDK，不是无损原生 roles 输入。'
        : capability?.historyMode ? `输入模式：${capability.historyMode}` : '输入模式尚未由服务端声明。';
}
