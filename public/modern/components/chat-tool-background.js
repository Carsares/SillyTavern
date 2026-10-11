// 聊天工具「聊天背景」面板的空桩，由 B5（背景与氛围音）功能代理实现，别的功能不要改这个文件。
// 背景图本身画在消息列表后面，插槽见 chat-backdrop.js；这里只放选择和锁定背景的控件。
// 接入方式见 chat-tools.js 顶部注释。isAvailable() 返回 false 时抽屉里没有这个标签，聊天头部也不会因它出现「聊天工具」按钮。
export function createChatToolBackgroundPanel(ctx) {
    return {
        id: 'background',
        label: '聊天背景',
        icon: 'fa-image',
        isAvailable() {
            return false;
        },
        render() {
            return '';
        },
    };
}
