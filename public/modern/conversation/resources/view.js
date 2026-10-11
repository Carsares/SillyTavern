import { connectionGuidance } from './guidance.js';
import { RESOURCE_KINDS } from '../../../shared/conversation/schemas/index.js';
import { el, button, field, input, select, parseObject, empty } from '../core/dom.js';
import { resourceDefaults, EXECUTORS, newWorldEntry, newPromptBlock } from './model.js';
import { list, redact } from '../core/state.js';
const names = { character: '角色', persona: '人设', preset: '预设', worldbook: '世界书', group: '群组', connection: '连接' };
export function createResources(app) {
    const kind = select(RESOURCE_KINDS.map(k => [k, names[k]]), 'character');
    const rows = el('div', { class: 'resource-list' });
    const editor = el('div');
    const root = el('section', {}, el('h2', {}, '资源管理'), field('资源类型', kind), button('新建资源', () => app.run(() => edit(null))), button('刷新', () => app.run(load)), rows, editor);
    kind.addEventListener('change', () => { editor.replaceChildren(); app.run(load); });
    async function load() {
        const entries = list(await app.api.resources(kind.value), 'resources');
        rows.replaceChildren(...(entries.length ? entries.map(resource => el('article', { class: 'card' },
            el('strong', {}, resource.name), el('small', {}, `${resource.id} · 版本 ${resource.revision}`),
            button('编辑', () => app.run(async () => edit(await app.api.resource(resource.id)))),
            button('删除', () => app.run(async () => {
                if (!confirm(`删除资源“${resource.name}”？`)) return;
                await app.api.deleteResource(resource.id, resource.revision); editor.replaceChildren(); await load();
            })),
        )) : [empty('该类型暂无资源')]));
    }
    async function edit(resource) {
        const resourceKind = resource?.kind || kind.value;
        const current = resource?.data || resourceDefaults(resourceKind);
        const common = {};
        const commonFields = [];
        if (resourceKind === 'connection') {
            for (const [key, label, type] of [['provider', '服务商', 'text'], ['executor', '执行器（pi / claude / codex）', 'text'], ['baseUrl', '服务地址', 'url'], ['model', '模型', 'text'], ['contextWindow', '上下文窗口', 'number'], ['inputLimit', '输入上限（可空）', 'number'], ['outputLimit', '输出上限', 'number'], ['maxOutputTokens', '本次最大输出', 'number'], ['workingBudget', '工作预算', 'number']]) {
                common[key] = key === 'executor' ? select(EXECUTORS, current[key] === 'native' ? 'pi' : current[key] || 'pi') : input(current[key] ?? '', { type, ...(type === 'number' ? { min: 1, step: 1 } : {}) });
                commonFields.push(field(label, common[key]));
            }
        }
        if (resourceKind === 'connection') {
            const mode = current.historyMode || 'native-transcript';
            const modes = [['native-transcript', '原生角色消息（默认）'], ['structured-transcript', '结构化转录']];
            if (!modes.some(([value]) => value === mode)) modes.push([mode, mode]);
            common.historyMode = select(modes, mode);
            commonFields.push(field('请求的历史输入模式（实际模式以服务端能力为准）', common.historyMode));
        }
        if (resourceKind === 'character' || resourceKind === 'persona') {
            for (const [key, label] of [['description', '描述'], ['personality', '性格'], ['scenario', '场景']]) {
                common[key] = el('textarea', { value: current[key] || '', rows: 3 });
                commonFields.push(field(label, common[key]));
            }
        }
        if (resourceKind === 'preset') {
            common.mode = select([['chat', '聊天消息'], ['text', '文本补全']], current.mode || 'chat');
            common.system = el('textarea', { value: current.system || '', rows: 4 });
            commonFields.push(field('预设编译模式', common.mode), field('系统设定（支持新协议宏）', common.system));
        }
        let members;
        let mode;
        if (resourceKind === 'group') {
            const characters = list(await app.api.resources('character'), 'resources');
            members = characters.map(character => ({ id: character.id, name: character.name, control: input('', { type: 'checkbox', checked: current.members?.includes(character.id) || false }) }));
            mode = select([['sequential', '顺序发言'], ['natural', '自然激活'], ['round-robin', '轮流发言']], current.mode || 'sequential');
            commonFields.push(field('群聊调度', mode), el('fieldset', {}, el('legend', {}, '成员（顺序使用下方 JSON 的 members；新勾选成员追加在末尾）'), ...members.map(member => field(member.name, member.control))));
        }
        const name = input(resource?.name || '', { required: true });
        const data = el('textarea', { rows: 16, value: JSON.stringify(redact(resource?.data || resourceDefaults(resourceKind)), null, 2), spellcheck: false, 'aria-label': '资源 JSON' });
        const key = input('', { type: 'password', autocomplete: 'new-password', placeholder: '留空保留已有密钥' });
        const headers = el('textarea', { rows: 2, placeholder: '可选私密请求头 JSON（写入后不回显）', 'aria-label': '私密请求头' });
        const form = el('form', {}, el('h3', {}, resource ? `编辑${names[resourceKind]}` : `新建${names[resourceKind]}`),
            field('名称', name), ...commonFields, field('资源内容 JSON（上方字段优先；其余字段原样提交）', data),
            ...(resourceKind === 'worldbook' || resourceKind === 'preset' ? [button(resourceKind === 'worldbook' ? '添加世界书条目' : '添加提示块', () => app.run(async () => {
                const value = parseObject(data.value);
                const key = resourceKind === 'worldbook' ? 'entries' : 'blocks';
                if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`${key} 必须是数组`);
                value[key] = [...(value[key] || []), resourceKind === 'worldbook' ? newWorldEntry(crypto.randomUUID()) : newPromptBlock(crypto.randomUUID())];
                data.value = JSON.stringify(value, null, 2);
            }))] : []),
            ...(resourceKind === 'connection' ? [connectionGuidance(), el('p', {}, '上下文和输出上限请填写所选模型的实际能力，界面不猜测默认额度。默认请求原生角色消息输入；保存后可在设置中检查服务端报告的实际输入模式与可用性。'), field('API 密钥（只写）', key), field('私密请求头（只写）', headers), el('p', {}, '密钥和请求头不会回显；密钥留空保留，私密请求头需重新填写。模型和执行器可用性以能力检查结果为准。')] : []),
            el('button', { type: 'submit' }, '保存资源'), button('取消', () => editor.replaceChildren()),
        );
        form.addEventListener('submit', event => {
            event.preventDefault(); app.run(async () => {
                const parsed = parseObject(data.value);
                // Secrets belong only in the explicit write-only inputs.
                if (JSON.stringify(redact(parsed)) !== JSON.stringify(parsed)) throw new Error('敏感字段请使用密钥或私密请求头输入框');
                if (['character', 'persona', 'preset'].includes(resourceKind)) for (const [key, control] of Object.entries(common)) parsed[key] = control.value;
                if (resourceKind === 'group') {
                    const selected = members.filter(member => member.control.checked).map(member => member.id);
                    const ordered = Array.isArray(parsed.members) ? parsed.members.filter(id => selected.includes(id)) : [];
                    parsed.members = [...new Set([...ordered, ...selected])];
                    parsed.mode = mode.value;
                }
                if (resourceKind === 'connection') {
                    for (const [fieldName, control] of Object.entries(common)) {
                        if (control.type === 'number') {
                            if (!control.value) { delete parsed[fieldName]; continue; }
                            const value = Number(control.value);
                            if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${fieldName} 必须为正整数`);
                            parsed[fieldName] = value;
                        } else if (fieldName === 'historyMode' && !control.value) delete parsed[fieldName];
                        else parsed[fieldName] = control.value;
                    }
                    if (key.value) parsed.apiKey = key.value;
                    if (headers.value.trim()) parsed.headers = parseObject(headers.value);
                }
                try {
                    if (resource) await app.api.updateResource(resource.id, { expectedRevision: resource.revision, name: name.value, data: parsed });
                    else await app.api.createResource({ kind: resourceKind, name: name.value, data: parsed });
                    editor.replaceChildren(); await load(); app.notice('资源已保存');
                } finally { key.value = ''; headers.value = ''; }
            });
        });
        editor.replaceChildren(form);
    }
    return { root, load };
}
