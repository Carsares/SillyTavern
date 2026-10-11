// 消息列表背景插槽，由 B5（聊天背景）功能代理实现 renderChatBackdrop，别的功能不要改这个文件。
// 返回的 HTML 会被 chat-thread.js 插到 .message-list-frame 的第一个子节点位置，
// 样式见 styles/routes/chat.css 的 .chat-backdrop：铺满列表框、在消息之下、不接收鼠标事件。
// 返回空字符串时什么都不渲染，页面与没有这个插槽时完全一致。
export function createChatBackdropComponent(ctx) {
    function renderChatBackdrop() {
        return '';
    }

    return {
        renderChatBackdrop,
    };
}
