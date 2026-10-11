// 聊天工具「聊天摘要」面板的空桩，由 A6（长对话摘要）功能代理实现，别的功能不要改这个文件。
// 接入方式见 chat-tools.js 顶部注释。isAvailable() 返回 false 时抽屉里没有这个标签，聊天头部也不会因它出现「聊天工具」按钮。
export function createChatToolSummaryPanel(ctx) {
    return {
        id: 'summary',
        label: '聊天摘要',
        icon: 'fa-align-left',
        isAvailable() {
            return false;
        },
        render() {
            return '';
        },
    };
}
