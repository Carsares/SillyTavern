import { createAutomaticControl } from './automatic.js';
import { TOOL_LIMITS } from '../../../shared/conversation/schemas/index.js';
import { el, field, button, select, input, parseObject, json, empty } from '../core/dom.js';
import { historyModeDescription } from '../resources/model.js';
import { list, redact } from '../core/state.js';

export function createSettings(app) {
    let automatic;
    let automaticConversationId;
    const form = el('form');
    const capabilities = el('div');
    const root = el('section', {}, el('h2', {}, '会话、群聊与能力预算'), form, capabilities);
    async function load() {
        automatic?.dispose(); automatic = null; automaticConversationId = null;
        if (!app.state.snapshot) { form.replaceChildren(empty('请先选择会话')); return; }
        const snapshot = app.state.snapshot;
        const settings = snapshot.settings || snapshot.conversation.settings || {};
        const resources = list(await app.api.resources(), 'resources');
        const controls = {};
        const selectors = [['connectionId', 'connection', '连接'], ['characterId', 'character', '角色'], ['personaId', 'persona', '人设'], ['presetId', 'preset', '预设'], ['groupId', 'group', '群组']];
        const fields = selectors.map(([key, kind, label]) => {
            controls[key] = select([['', '未选择'], ...resources.filter(r => r.kind === kind).map(r => [r.id, `${r.name} · v${r.revision}`])], settings[key]);
            return field(label, controls[key]);
        });
        const books = resources.filter(r => r.kind === 'worldbook').map(resource => {
            const control = input('', { type: 'checkbox', checked: settings.worldbookIds?.includes(resource.id) || false });
            return { id: resource.id, node: field(resource.name, control), control };
        });
        const tools = ['recall_memory', 'search_lore', 'update_memory', 'roll_dice', 'get_time', 'generate_image'].map(name => ({ name, control: input('', { type: 'checkbox', checked: settings.tools == null ? !['update_memory', 'generate_image'].includes(name) : Array.isArray(settings.tools) ? settings.tools.includes(name) : settings.tools[name] === true }) }));
        const limits = {};
        const limitFields = Object.entries(TOOL_LIMITS).map(([key, fallback]) => {
            limits[key] = input((key === 'turnTimeoutMs' ? settings.turnTimeoutMs : settings.toolLimits?.[key]) ?? fallback, { type: 'number', min: 1, step: 1 });
            return field(key, limits[key]);
        });
        const automaticInterval = input(30000, { type: 'number', min: 1000, max: 3600000, step: 1000 });
        const automaticContent = input('Continue the group conversation.');
        const automaticStatus = el('p', { role: 'status', 'aria-live': 'polite' });
        const enableAutomatic = button('启用自动群聊', () => app.run(() => automatic.set(snapshot, true, { intervalMs: Number(automaticInterval.value), content: automaticContent.value })));
        const disableAutomatic = button('停用自动群聊', () => app.run(() => automatic.set(snapshot, false)));
        automaticConversationId = snapshot.conversation.id;
        automatic = createAutomaticControl({ api: app.api, conversationId: automaticConversationId, onChange(state) {
            automaticStatus.textContent = state.loading ? '正在读取或更新服务端调度状态…' : state.error ? `状态未知：${state.error}` : state.enabled ? '自动群聊：已启用' : '自动群聊：已关闭';
            enableAutomatic.disabled = state.loading || state.enabled !== false || !settings.groupId || !settings.connectionId;
            disableAutomatic.disabled = state.loading || state.enabled === false;
        } });
        const extra = el('textarea', { rows: 10, value: JSON.stringify(redact(settings), null, 2), 'aria-label': '高级会话设置' });
        const budgetInfo = el('p', {}, '连接资源设置上下文窗口、输入/输出上限、工作预算。群组资源设置成员与调度；下面可编辑会话级高级设置。');
        form.replaceChildren(...fields, el('fieldset', {}, el('legend', {}, '世界书'), ...books.map(b => b.node)),
            el('fieldset', {}, el('legend', {}, '可用工具（能力检查仍由服务器执行）'), ...tools.map(tool => field(tool.name, tool.control))),
            el('details', {}, el('summary', {}, '工具限制'), ...limitFields),
            field('高级设置 JSON（选择器中的资源选择会覆盖对应字段）', extra), budgetInfo,
            el('button', { type: 'submit' }, '保存会话设置'),
            button('检查所选连接能力', () => app.run(async () => {
                const result = await app.api.capabilities(controls.connectionId.value);
                capabilities.replaceChildren(el('h3', {}, result.supported === false ? '当前组合不可用' : '服务器报告的能力'), el('p', {}, historyModeDescription(result)), json(redact(result)));
            })),
            el('details', { open: true }, el('summary', {}, '群聊自动模式（服务端调度）'),
                automaticStatus, el('p', {}, '进程重启后自动群聊默认关闭，不自动重发收费请求。生成失败或停止后也会关闭调度。'),
                field('间隔毫秒', automaticInterval), field('触发内容', automaticContent),
                enableAutomatic, disableAutomatic, button('刷新调度状态', () => automatic.refresh())),
        );
        await automatic.refresh();
        form.onsubmit = event => {
            event.preventDefault(); app.run(async () => {
                const next = parseObject(extra.value);
                if (JSON.stringify(redact(next)) !== JSON.stringify(next)) throw new Error('会话设置不接受凭据；请在连接资源中配置');
                for (const [key] of selectors) next[key] = controls[key].value || null;
                next.tools = tools.filter(tool => tool.control.checked).map(tool => tool.name);
                next.toolLimits = Object.fromEntries(Object.entries(limits).map(([key, control]) => {
                    const value = Number(control.value);
                    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} 必须为正整数`);
                    return [key, value];
                }));
                next.turnTimeoutMs = next.toolLimits.turnTimeoutMs;
                delete next.toolLimits.turnTimeoutMs;
                next.worldbookIds = books.filter(b => b.control.checked).map(b => b.id);
                await app.applyCommand('conversation.configure', { settings: next }, snapshot);
                await load(); app.notice('会话设置已保存');
            });
        };
    }
    return { root, load, onEvent(event) {
        if (event.type === 'automatic.changed' && event.conversationId === automaticConversationId) void automatic?.refresh();
    } };
}
