// 设置页「聊天工具」标签里的翻译设置分区，由 B3（翻译）功能代理实现，别的功能不要改这个文件。
// render() 返回一个完整的 <section class="form-section">…</section>；isAvailable() 为 false 时分区不显示。
// 事件写在 routes/settings-tool-translate-events.js；业务动作的注册方式见 components/chat-tools.js 顶部注释。
export function createSettingsToolTranslate(ctx) {
    return {
        id: 'translate',
        label: '翻译',
        isAvailable() {
            return false;
        },
        render() {
            return '';
        },
    };
}
