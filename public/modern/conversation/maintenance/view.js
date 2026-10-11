import { el, button, field, input, json, download } from '../core/dom.js';
import { BACKUP_MAX_BYTES, BACKUP_COPY_GUIDANCE, restoreBody, cleanupRequest, effectiveExport } from './model.js';
import { redact } from '../core/state.js';
import { runUncertainWrite } from '../core/operations.js';
export function storageStatusView(status) {
    const value = key => Number.isFinite(status?.[key]) && status[key] >= 0 ? String(status[key]) : '未知';
    return el('section', { 'aria-label': '存储用量' }, el('h3', {}, '轨迹存储'),
        el('p', {}, `轨迹数量：${value('traceCount')} · 轨迹逻辑字节：${value('traceBytes')} · 明细逻辑字节：${value('detailBytes')}`),
        el('p', {}, '字节数按 UTF-8 JSON 计算，不代表 SQLite 文件占用；清理明细保留用量账目。'), json(redact(status)));
}
export function createMaintenance(app) {
    const output = el('div');
    const previewOutput = el('div');
    const file = input('', { type: 'file', accept: '.json,application/json' });
    const scope = input('', { placeholder: '预览后输入“清理”' });
    let preview = null;
    const retention = input(30, { type: 'number', min: 0, step: 'any', 'aria-label': '轨迹明细保留天数' });
    retention.addEventListener('input', () => { preview = null; scope.value = ''; previewOutput.replaceChildren(el('p', {}, '保留期限已改变，请重新预览。')); });
    const root = el('section', {}, el('h2', {}, '备份、恢复与清理'),
        el('p', {}, '恢复仅允许空的新存储。清理必须先读取服务器预览，再明确确认。备份不包含连接凭据。JSON 备份/恢复包体上限 256 MiB（含封装），普通请求上限 20 MiB。'),
        el('p', {}, BACKUP_COPY_GUIDANCE),
        button('查看存储用量', () => app.run(async () => { output.replaceChildren(storageStatusView(await app.api.maintenance('status'))); })),
        button('重建当前会话索引', () => app.run(async () => {
            const conversationId = app.id();
            // Rebuilding calls the embedding provider again; an unknown outcome shows the index state instead.
            const result = await runUncertainWrite(() => app.api.maintenance('reindex', { conversationId }), async () => {
                output.replaceChildren(el('h3', {}, '重新读取的索引状态'), json(redact(await app.api.retrievalStatus(conversationId))));
            });
            output.replaceChildren(json(redact(result)));
        })),
        button('导出有效历史', () => app.run(async () => {
            const data = await app.api.maintenance('export');
            download('conversation-effective-history.json', effectiveExport(data));
            app.notice('已导出当前有效历史；不含隐藏消息和旧候选，不能作为完整恢复备份。');
        })),
        button('下载备份', () => app.run(async () => {
            const data = await app.api.maintenance('backup', {});
            if (data?.format !== 'conversation-v1-backup' || data?.credentialsIncluded !== false) throw new Error('服务器未确认备份已排除凭据，未下载');
            download(`conversation-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
            app.notice('服务器备份已下载；连接凭据需重新填写');
        })), field('恢复文件', file),
        button('恢复到空存储', () => app.run(async () => {
            const selected = file.files[0];
            if (!selected) throw new Error('请选择备份文件');
            if (selected.size > BACKUP_MAX_BYTES) throw new Error(`恢复文件超过 256 MiB。${BACKUP_COPY_GUIDANCE}`);
            const data = JSON.parse(await selected.text());
            const body = restoreBody(data);
            if (!confirm('确认将备份恢复到新存储？非空存储应由服务器拒绝。')) return;
            const result = await runUncertainWrite(() => app.api.maintenance('restore', body), () => app.reloadConversations());
            output.replaceChildren(json(redact(result))); file.value = ''; await app.reloadConversations();
        })),
        el('p', {}, '有效历史导出仅含当前有效内容；完整恢复请下载备份。轨迹清理删除旧请求明细，保留用量账目；附件仅清理服务器确认无引用且满足保留期的文件。'),
        field('轨迹明细保留天数（0 表示预览全部已完成轨迹）', retention),
        button('查看清理预览', () => app.run(async () => {
            preview = null; scope.value = ''; previewOutput.replaceChildren();
            preview = await app.api.maintenance('cleanup-preview', cleanupRequest(retention.value));
            previewOutput.replaceChildren(el('h3', {}, '本次清理预览'), el('p', {}, `附件 ${preview.entries?.length ?? '未知'} 项 · 轨迹明细 ${preview.traces?.length ?? '未知'} 项 · 附件字节 ${preview.bytes ?? '未知'}；保留用量账目。`), json(redact(preview)));
        })), previewOutput, field('输入“清理”确认预览内容', scope),
        button('执行已预览的清理', () => app.run(async () => {
            if (!preview?.token || scope.value !== '清理') throw new Error('请先获取清理预览并输入“清理”');
            if (!confirm('确认执行服务器预览中的清理操作？')) return;
            const result = await app.api.maintenance('cleanup', { token: preview.token });
            preview = null; scope.value = ''; previewOutput.replaceChildren(); output.replaceChildren(json(redact(result))); await app.reloadConversations();
        })), output,
    );
    return { root };
}
