import { el, json } from '../core/dom.js';
export const CONNECTION_GUIDANCE = Object.freeze({
    type: 'chat',
    reasoning: 'high',
    capabilities: { verified: false, reasoningEnabled: true, reasoningEfforts: ['high'], media: ['text', 'image'], mediaTokenCost: { image: 1024 } },
});
export function connectionGuidance() {
    return el('details', {}, el('summary', {}, '连接类型、推理和媒体字段说明'),
        el('p', {}, '连接资源 JSON 是平面对象，provider 使用服务端认可的标识，例如 openai、openai-compatible、anthropic、google、vertexai、deepseek。自定义兼容端点使用 openai-compatible；未知标识由服务端明确拒绝。'),
        el('p', {}, '在资源 JSON 中设置 type：chat 聊天、text 文本补全、embedding 检索嵌入、image 图片工具。记忆／摘要请选择 chat 或 text 连接。文本补全还需选择 mode=text 的预设。'),
        el('p', {}, '推理请求使用字符串 reasoning，例如 off、high、budget；不能使用对象。能力声明放在 capabilities.reasoningEnabled 与 capabilities.reasoningEfforts；具体可选档位由服务端能力返回决定，不能对所有服务商照搬 high。预算式推理还需按提供方协议配置 reasoningBudget。'),
        el('p', {}, '媒体声明使用 capabilities.media，取值 text/image/audio/video/document；capabilities.mediaTokenCost 为每种媒体的正整数预算，不能放在连接顶层。PDF 和 text/plain 属于 document。只有真实核验后才可将 capabilities.verified 设为 true；上传成功不代表模型支持。'),
        el('p', {}, '以下仅展示字段结构，示例 1024 不是推荐预算，不会自动写入。保存后在会话设置中检查该连接能力；unsupported 或参数错误应先修正。'), json(CONNECTION_GUIDANCE));
}
