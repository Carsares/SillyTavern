// 输入框下方的连接标签插槽，由 B1（聊天内切换模型和连接档案）功能代理实现 renderChatConnectionChip，别的功能不要改这个文件。
// 返回的 HTML 放进 chat-composer.js 的 .composer-meta 行（整行占满输入框下方，其中的按钮不受 .composer button 的定位规则影响）；
// 点击事件写在 routes/chat-connection-events.js。返回空字符串时不渲染这一行。
export function createChatConnectionChipComponent(ctx) {
    function renderChatConnectionChip() {
        return '';
    }

    return {
        renderChatConnectionChip,
    };
}
