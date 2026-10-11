import { el, button, field, input, json, download } from '../core/dom.js';
import { redact } from '../core/state.js';
export function createMaintenance(app) {
    const output = el('div');
    const file = input('', { type: 'file', accept: '.json,application/json' });
    const scope = input('', { placeholder: '预览后输入“清理”' });
    let preview = null;
    const root = el('section', {}, el('h2', {}, '备份、恢复与清理'),
        el('p', {}, '恢复仅允许空的新存储。清理必须先读取服务器预览，再明确确认。备份不包含连接凭据。'),
        button('查看存储用量', () => app.run(async () => { output.replaceChildren(json(redact(await app.api.maintenance('status')))); })),
        button('重建当前会话索引', () => app.run(async () => {
            const result = await app.api.maintenance('reindex', { conversationId: app.id() });
            output.replaceChildren(json(redact(result)));
        })),
        button('导出新格式', () => app.run(async () => {
            const data = await app.api.maintenance('export');
            if (data?.credentialsIncluded !== false) throw new Error('服务器未确认导出已排除凭据，未下载');
            download('conversation-export.json', data);
        })),
        button('下载备份', () => app.run(async () => {
            const data = await app.api.maintenance('backup', {});
            if (data?.credentialsIncluded !== false) throw new Error('服务器未确认备份已排除凭据，未下载');
            download(`conversation-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
            app.notice('服务器备份已下载；连接凭据需重新填写');
        })), field('恢复文件', file),
        button('恢复到空存储', () => app.run(async () => {
            const selected = file.files[0];
            if (!selected) throw new Error('请选择备份文件');
            if (selected.size > 19 * 1024 * 1024) throw new Error('恢复文件超过 19 MiB');
            const data = JSON.parse(await selected.text());
            if (!confirm('确认将备份恢复到新存储？非空存储应由服务器拒绝。')) return;
            const result = await app.api.maintenance('restore', { data });
            output.replaceChildren(json(redact(result))); file.value = ''; await app.reloadConversations();
        })),
        button('查看清理预览', () => app.run(async () => {
            preview = await app.api.maintenance('cleanup-preview', {}); scope.value = '';
            output.replaceChildren(json(redact(preview)));
        })), field('输入“清理”确认预览内容', scope),
        button('执行已预览的清理', () => app.run(async () => {
            if (!preview?.token || scope.value !== '清理') throw new Error('请先获取清理预览并输入“清理”');
            if (!confirm('确认执行服务器预览中的清理操作？')) return;
            const result = await app.api.maintenance('cleanup', { token: preview.token });
            preview = null; scope.value = ''; output.replaceChildren(json(redact(result))); await app.reloadConversations();
        })), output,
    );
    return { root };
}
