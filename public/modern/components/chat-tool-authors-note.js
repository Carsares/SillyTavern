// 聊天工具「作者注释」面板的空桩，由 A5（作者注释）功能代理实现，别的功能不要改这个文件。
// 接入方式见 chat-tools.js 顶部注释。isAvailable() 返回 false 时抽屉里没有这个标签，聊天头部也不会因它出现「聊天工具」按钮。
export function createChatToolAuthorsNotePanel(ctx) {
    return {
        id: 'authors-note',
        label: '作者注释',
        icon: 'fa-note-sticky',
        isAvailable() {
            return false;
        },
        render() {
            return '';
        },
    };
}
