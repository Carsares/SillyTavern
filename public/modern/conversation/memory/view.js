import { jobView } from '../jobs/view.js';
import { sourcesView } from './sources.js';
import { MEMORY_KINDS, memoryInput } from './model.js';
import { el, button, empty, field, input, select } from '../core/dom.js';
import { terminal, redact, list } from '../core/state.js';
import { refreshAfterWrite, runUncertainWrite } from '../core/operations.js';
export function createMemory(app) {
    const drafts = new Map();
    let savedJobs = [];
    const rows = el('div');
    const jobs = el('div');
    let creationSnapshot = null;
    const kind = select(MEMORY_KINDS, 'user-fact', { 'aria-label': '新记忆类型' });
    const content = el('textarea', { rows: 4, required: true, maxLength: 8000, placeholder: '输入需要保留的人工记忆', 'aria-label': '新记忆内容' });
    const locked = input('', { type: 'checkbox' });
    const creationControls = el('fieldset', {}, field('记忆类型', kind), field('内容', content), field('锁定此记忆', locked), el('button', { type: 'submit' }, '新建记忆'));
    const createForm = el('form', {}, el('h3', {}, '手工新建记忆'), creationControls);
    createForm.addEventListener('submit', event => {
        event.preventDefault();
        app.run(async () => {
            await app.applyCommand('memory.create', memoryInput(kind.value, content.value, locked.checked), creationSnapshot);
            content.value = ''; locked.checked = false; creationSnapshot = app.state.snapshot;
            render(); app.notice('人工记忆已保存');
        });
    });
    const root = el('section', {}, el('h2', {}, '记忆与压缩'), el('p', {}, '失效与待确认内容保持可见；锁定记忆由版本化命令保护。'),
        button('请求压缩历史', () => app.run(async () => {
            const id = app.id();
            const { contentRevision, memoryRevision } = app.state.snapshot.conversation;
            // Compression waits for a billed model summary and is not cancelled by a disconnect.
            await runUncertainWrite(() => app.api.compact(id, { expectedContentRevision: contentRevision, expectedMemoryRevision: memoryRevision }),
                async () => { await app.refresh(); await load(); });
            await refreshAfterWrite(() => app.refresh(), warning => { app.state.error = warning; });
            app.notice('压缩请求已提交，请查看服务器返回的摘要和折叠记录');
        })), button('刷新后台任务', () => app.run(load)), createForm, rows, jobs);
    async function load() {
        savedJobs = list(await app.api.jobs(app.id()), 'jobs'); creationSnapshot = app.state.snapshot; render();
    }
    function render() {
        const snapshot = app.state.snapshot;
        if (creationSnapshot?.conversation.id !== snapshot?.conversation.id) {
            creationSnapshot = snapshot; content.value = ''; locked.checked = false;
        }
        // New records have no existing block to overwrite; use the latest displayed versions.
        creationSnapshot = snapshot;
        creationControls.disabled = !snapshot || !terminal(app.state.turn) || !!snapshot?.conversation.activeTurnId;
        const events = (app.state.activity || []).filter(event => event.type === 'job.updated' || event.type === 'memory.updated' && event.payload?.status === 'failed');
        jobs.replaceChildren(el('h3', {}, '后台任务与事件'), ...savedJobs.filter(job => job.conversationId === snapshot?.conversation.id).map(job => jobView(app, job, load)), ...(events.length ? [el('details', {}, el('summary', {}, '任务事件记录'), ...events.map(event => el('article', { class: 'card' }, el('pre', {}, JSON.stringify(redact(event.payload), null, 2)))))] : [empty('尚未收到后台任务状态；这不代表任务已成功')]));
        const disabled = !terminal(app.state.turn) || !!snapshot?.conversation.activeTurnId;
        const blocks = [...(snapshot?.memories || []).map(b => ({ ...b, blockType: 'memory' })), ...(snapshot?.summaries || []).map(b => ({ ...b, blockType: 'summary' })), ...(snapshot?.folds || []).map(b => ({ ...b, blockType: 'fold' }))];
        rows.replaceChildren(...(blocks.length ? blocks.map(block => {
            const draftKey = `${snapshot.conversation.id}:${block.id}`;
            const draft = drafts.get(draftKey);
            const content = el('textarea', { value: draft?.content ?? block.content ?? '', rows: 4, 'aria-label': block.blockType === 'summary' ? '摘要内容' : '记忆内容', maxLength: block.blockType === 'summary' ? 16000 : 8000, disabled: disabled || block.blockType === 'fold', oninput: event => {
                drafts.set(draftKey, { content: event.target.value, revision: draft?.revision ?? block.revision });
            } });
            const version = { blockId: block.id, expectedBlockRevision: block.revision };
            return el('article', { class: `card status-${block.status}` },
                el('h3', {}, `${block.blockType} · ${block.status} ${block.locked ? '· 已锁定' : ''}`),
                el('small', {}, `${block.id} · 版本 ${block.revision}`), content,
                sourcesView(app, block),
                ...(block.blockType === 'summary' ? [
                    el('p', {}, '人工编辑保留来源并增加摘要版本，依赖旧版本的摘要与折叠会失效。'),
                    button('保存摘要', () => app.run(async () => {
                        if (!content.value.trim() || content.value.length > 16000) throw new Error('摘要须为 1 至 16000 字符');
                        await app.applyCommand('summary.edit', { summaryId: block.id, expectedBlockRevision: drafts.get(draftKey)?.revision ?? block.revision, content: content.value });
                        drafts.delete(draftKey); render();
                    }), disabled),
                    button('丢弃摘要编辑', () => { drafts.delete(draftKey); render(); }, disabled),
                ] : []),
                ...(block.blockType === 'memory' ? [
                    button('保存记忆', () => app.run(async () => {
                        await app.applyCommand('memory.edit', { ...version, expectedBlockRevision: drafts.get(draftKey)?.revision ?? block.revision, content: content.value });
                        drafts.delete(draftKey); render();
                    }), disabled),
                    button('丢弃本地编辑', () => { drafts.delete(draftKey); render(); }, disabled),
                    button(block.locked ? '解锁' : '锁定', () => app.command('memory.lock', { ...version, locked: !block.locked }), disabled),
                    button('确认记忆', () => app.command('memory.confirm', version), disabled || block.status !== 'pending-confirm'),
                ] : []),
                ...(block.blockType === 'fold' ? [button('展开原始历史', () => app.command('fold.expand', { ...version, foldId: block.id }), disabled)] : []),
            );
        }) : [empty('暂无记忆、摘要或折叠记录')]));
    }
    return { root, render, load };
}
