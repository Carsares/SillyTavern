// 设置页「聊天工具」标签里的推理解析设置分区（自动解析、加入提示词、前后缀、推理模板），
// 由 A2（推理模型参数）功能代理实现，别的功能不要改这个文件。GAP-PLAN 把这部分放在「聊天工具」标签下，所以这里预留了分区。
// render() 返回一个完整的 <section class="form-section">…</section>；isAvailable() 为 false 时分区不显示。
// 事件写在 routes/settings-tool-reasoning-events.js；业务动作的注册方式见 components/chat-tools.js 顶部注释。
export function createSettingsToolReasoning(ctx) {
    return {
        id: 'reasoning',
        label: '推理解析',
        isAvailable() {
            return false;
        },
        render() {
            return '';
        },
    };
}
