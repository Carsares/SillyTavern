import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from './bridge-protocol.js';

// 同步通道的 modern 侧触发助手：各保存动作成功后，通知隐藏 iframe 的生成引擎从后端重载对应状态，
// 消除跨 frame 的陈旧快照（改了生效）。reload 是主保存之上的附加动作，任何一路失败都只 console.warn
// 不抛，确保 reload 失败不会让用户误以为主保存失败。
export function createBridgeReload(callLegacyBridge) {
    // fire-and-forget：只触发后端重载，不 await —— 避免阻塞主保存的 UI 流程（bridge 往返最长可达数十秒）。
    // 失败只 console.warn 不冒泡，确保 reload 失败绝不影响已成功的主保存。
    function reloadChat(payload = {}) {
        callLegacyBridge(BRIDGE_ACTIONS.RELOAD_CHAT, payload, BRIDGE_TIMEOUTS.STATUS)
            .catch(error => console.warn('Modern bridge reloadChat failed', error));
    }

    function reloadCharacter() {
        callLegacyBridge(BRIDGE_ACTIONS.RELOAD_CHARACTER, {}, BRIDGE_TIMEOUTS.STATUS)
            .catch(error => console.warn('Modern bridge reloadCharacter failed', error));
    }

    function reloadSettings() {
        callLegacyBridge(BRIDGE_ACTIONS.RELOAD_SETTINGS, {}, BRIDGE_TIMEOUTS.STATUS)
            .catch(error => console.warn('Modern bridge reloadSettings failed', error));
    }

    return { reloadChat, reloadCharacter, reloadSettings };
}
