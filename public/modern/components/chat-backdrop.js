// 消息列表背景插槽（B5 聊天背景）：返回的 HTML 会被 chat-thread.js 插到 .message-list-frame 的第一个子节点位置，
// 样式见 styles/routes/chat.css 的 .chat-backdrop（基础）和「聊天背景（B5）」一节（图片、填充方式、遮罩）。
// 返回空字符串时什么都不渲染，页面与没有背景时完全一致。
//
// 背景取聊天锁定（chat_metadata.custom_background）> 全局背景（settings.background）> 无，解析与校验见 core/chat-background.js：
// 只接受 backgrounds/ 和 user/images/ 下的站内路径，其余（外链、data:、路径穿越）一律当作没有。
// 图片是否真的能加载由 routes/chat-tool-background-events.js 的 afterRender 探测，失败的路径记入 state.chatBackground.failed 后回退到全局。
import { isAnimatedBackground } from '../core/chat-background.js';

export function createChatBackdropComponent(ctx) {
    const { state, escapeHtml, getChatBackgroundInfo } = ctx;

    function prefersReducedMotion() {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // 服务端已标出动画的系统背景（/api/backgrounds/all 的 isAnimated）；专属图只能按扩展名判断
    function isKnownAnimated(resolved) {
        if (resolved.kind !== 'system') {
            return false;
        }
        const filename = resolved.file.slice('backgrounds/'.length);
        const images = Array.isArray(state.backgrounds?.images) ? state.backgrounds.images : [];
        return images.some(image => typeof image === 'object' && image?.filename === filename && Boolean(image.isAnimated));
    }

    function renderChatBackdrop() {
        if (typeof getChatBackgroundInfo !== 'function') {
            return '';
        }

        const info = getChatBackgroundInfo();
        const { resolved } = info;
        if (!info.enabled || resolved.source === 'none') {
            return '';
        }
        // CSS 无法暂停动画图片：系统要求减少动态效果时，动画背景不显示，静态背景不受影响
        if (prefersReducedMotion() && isAnimatedBackground(resolved.name, isKnownAnimated(resolved))) {
            return '';
        }

        // resolved.path 由 core/chat-background.js 逐段重新编码，只含字母数字和 %./_~-，写进 url('…') 不会被截断
        return `<div class="chat-backdrop" data-chat-backdrop data-chat-bg-source="${resolved.source}" data-chat-bg-path="${escapeHtml(resolved.path)}" data-fit="${escapeHtml(resolved.fitting)}" style="--chat-bg-dim: ${info.dim}%; background-image: url('${escapeHtml(resolved.path)}')" aria-hidden="true"></div>`;
    }

    return {
        renderChatBackdrop,
    };
}
