import { el, button, field, empty, json, input } from '../core/dom.js';
import { contextView } from '../diagnostics/context.js';
import { attachmentPart, assertMediaCapability, encodeBase64 } from '../media/model.js';
import { mediaView, toolMediaView } from '../media/view.js';
import { historyModeDescription } from '../resources/model.js';
import { list, redact, terminal, estimateRequest } from '../core/state.js';

export function createChat(app) {
    const edits = new Map();
    const messageNodes = new Map();
    let messageRenderKey;
    let attachments = [];
    const attachmentRows = el('div');
    const attachmentFile = input('', { type: 'file', 'aria-label': '附件文件' });
    const memberIds = input('', { placeholder: '可选：群聊成员 ID，逗号分隔', 'aria-label': '手动指定群聊成员' });
    const capabilityInfo = el('p', { class: 'empty' });
    const messages = el('section', { class: 'messages', 'aria-label': '消息历史' });
    const live = el('section', { class: 'live-turn', 'aria-live': 'polite' });
    const draft = el('textarea', { rows: 4, placeholder: '写下消息，Ctrl / ⌘ + Enter 发送', 'aria-label': '消息草稿' });
    const estimate = el('div', { class: 'estimate' });
    const send = type => app.run(async () => {
        const connectionId = (app.state.snapshot?.settings || app.state.snapshot?.conversation.settings)?.connectionId;
        if (!connectionId) throw new Error('请先在设置中选择连接');
        const capability = await app.api.capabilities(connectionId);
        capabilityInfo.textContent = historyModeDescription(capability);
        if (capability.supported === false || capability.types && !capability.types.includes(type)) throw new Error(capability.reason || '当前连接不支持此生成类型');
        if (attachments.length && !['send', 'group'].includes(type)) throw new Error('附件只用于发送或群聊，请先移除附件后生成草稿');
        assertMediaCapability(capability, attachments);
        const members = type === 'group' && memberIds.value.trim() ? memberIds.value.split(',').map(id => id.trim()).filter(Boolean) : undefined;
        await app.start(type, draft.value, undefined, { media: attachments, members });
        if (type === 'send' || type === 'group') { draft.value = ''; attachments = []; renderAttachments(); }
    });
    draft.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); send((app.state.snapshot?.settings || app.state.snapshot?.conversation.settings)?.groupId ? 'group' : 'send'); }
    });
    const controls = el('div', { class: 'actions' },
        button('发送', () => send('send')), button('群聊发送', () => send('group')),
        button('扮演草稿', () => send('impersonate')), button('辅助草稿', () => send('auxiliary')),
        button('估算上下文', () => app.run(async () => {
            const result = await app.api.estimate(app.id(), estimateRequest(draft.value, attachments));
            estimate.replaceChildren(el('p', {}, '上下文估算（是否精确以返回的计数方式为准）'), contextView(result));
        })),
    );
    const submit = el('fieldset', {}, field('输入', draft), field('媒体附件（单个不超过 8 MiB）', attachmentFile),
        button('上传附件到草稿', () => app.run(async () => {
            const file = attachmentFile.files[0];
            if (!file) throw new Error('请选择文件');
            if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('附件必须为 1 字节至 8 MiB');
            const record = await app.api.uploadAttachment({ name: file.name, mime: file.type || 'application/octet-stream', base64: encodeBase64(new Uint8Array(await file.arrayBuffer())) });
            attachments.push(attachmentPart(record)); attachmentFile.value = ''; renderAttachments();
            app.notice('附件已保存到服务器并加入草稿；尚未发送给模型，发送时检查媒体能力');
        })), attachmentRows, field('手动指定群聊成员', memberIds), controls, capabilityInfo);
    const stop = button('停止生成', () => app.run(async () => {
        await app.api.stop(app.state.turn.id); await app.refresh(); app.notice('停止请求已提交；轮次状态以服务器返回为准');
    }));
    const recovery = el('div');
    const activity = el('section', { 'aria-label': '工具与群聊进度' });
    const root = el('section', { class: 'chat-pane' }, messages, live, activity, recovery, stop, submit, estimate);
    function renderAttachments() {
        attachmentRows.replaceChildren(...attachments.map((part, index) => el('div', { class: 'card' }, mediaView(app.api, part), button('从草稿移除', () => { attachments.splice(index, 1); renderAttachments(); }))));
    }
    async function candidates(message, destination) {
        await app.run(async () => {
            const snapshot = app.state.snapshot;
            const entries = list(await app.api.candidates(app.id(), message.id), 'candidates');
            destination.replaceChildren(entries.length ? el('div', {}, entries.map(candidate => el('article', { class: 'card' },
                el('p', {}, `候选 ${candidate.candidateId ?? candidate.id} · 版本 ${candidate.candidateRevision ?? candidate.revision} · ${candidate.status === 'partial' ? '部分回复' : candidate.status || '状态未知'}${candidate.selected ? ' · 当前选中' : ''}`), el('pre', {}, candidate.content),
                button('选用候选', () => app.run(() => app.applyCommand('candidate.select', { messageId: message.id, candidateId: candidate.candidateId ?? candidate.id, candidateRevision: candidate.candidateRevision ?? candidate.revision }, snapshot)), candidate.selected === true || (candidate.candidateId ?? candidate.id) === message.candidateId && (candidate.candidateRevision ?? candidate.revision) === message.candidateRevision),
            ))) : empty('没有候选记录'));
        });
    }
    function editMessage(message, destination) {
        const edit = edits.get(message.id);
        const editor = el('textarea', { rows: 5, value: edit.content, 'aria-label': '编辑消息', oninput: event => { edit.content = event.target.value; } });
        destination.replaceChildren(editor, button('保存修改', () => app.run(async () => {
            await app.applyCommand('message.edit', { messageId: message.id, content: edit.content }, edit.snapshot);
            edits.delete(message.id); messageRenderKey = null; render();
        })), button('取消编辑', () => { edits.delete(message.id); destination.replaceChildren(); }));
    }
    function updateControls() {
        const { snapshot, turn, busy, pending } = app.state;
        const active = !terminal(turn) || !!snapshot?.conversation.activeTurnId;
        submit.disabled = busy || active || !snapshot || !!pending;
        stop.disabled = busy || !turn || terminal(turn) || turn.cancelRequested === true;
    }
    function render() {
        const { snapshot, turn, busy, pending, recoveredDraft } = app.state;
        const active = !terminal(turn) || !!snapshot?.conversation.activeTurnId;
        submit.disabled = busy || active || !snapshot || !!pending;
        stop.disabled = busy || !turn || terminal(turn) || turn.cancelRequested === true;
        const rows = snapshot?.messages || [];
        const renderKey = JSON.stringify([snapshot?.conversation.id, snapshot?.conversation.contentRevision, active, Boolean(pending)]);
        if (renderKey !== messageRenderKey) {
            messageRenderKey = renderKey;
            messageNodes.clear();
            messages.replaceChildren(...(rows.length ? rows.filter(m => !m.deletedAt).map(message => {
                const details = el('div');
                const actions = el('div', { class: 'actions' },
                    button('编辑', () => {
                        edits.set(message.id, { content: message.content, snapshot: app.state.snapshot });
                        editMessage(message, details);
                    }, active),
                    button('删除', () => { if (confirm('删除这条消息？相关记忆和摘要可能失效。')) app.command('message.delete', { messageId: message.id }); }, active),
                    ...(message.role === 'assistant' ? [
                        button('候选', () => candidates(message, details), active),
                        button('重生成', () => app.run(() => app.start('regenerate', '', message.id)), active || !!pending),
                        button('续写', () => app.run(() => app.start('continue', '', message.id)), active || !!pending),
                    ] : []),
                );
                if (edits.has(message.id)) editMessage(message, details);
                const node = el('article', { class: `message role-${message.role}`, tabIndex: -1 },
                    el('header', {}, `${message.role} · ${message.status || 'saved'} · 版本 ${message.revision}`),
                    el('pre', {}, message.content || '（空内容）'),
                    ...(message.media?.length ? [el('details', {}, el('summary', {}, `${message.media.length} 项媒体`), ...message.media.map(part => mediaView(app.api, part, snapshot.attachments?.[part.attachmentId])))] : []),
                    actions, details,
                );
                messageNodes.set(message.id, node);
                return node;
            }) : [empty(snapshot ? '还没有消息。选择连接和角色后开始对话。' : '选择或创建一个会话。')]));
        }
        live.replaceChildren(...(turn ? [el('h3', {}, `轮次 ${turn.cancelRequested && !terminal(turn) ? '正在停止' : turn.status}`),
            el('small', {}, `ID ${turn.id} · ${turn.type || turn.request?.type || ''}`),
            el('pre', {}, turn.content || '尚未收到正文'),
            ...(turn.reasoning ? [el('details', {}, el('summary', {}, '推理记录'), el('pre', {}, turn.reasoning))] : []),
            ...(turn.error ? [json(redact(turn.error))] : []),
            ...(turn.usage ? [el('details', {}, el('summary', {}, '服务器报告用量'), json(redact(turn.usage)))] : []),
            ...(terminal(turn) && turn.content && (turn.type === 'impersonate' || turn.type === 'auxiliary' || turn.status !== 'completed') ? [button('复制轮次内容到草稿', () => { draft.value = turn.content; draft.focus(); })] : []),
        ] : []));
        const events = (app.state.activity || []).filter(event => event.turnId === turn?.id && /^(tool\.|group\.|usage\.)/.test(event.type));
        activity.replaceChildren(...(events.length ? [el('details', { open: !terminal(turn) }, el('summary', {}, '工具调用、群聊进度与用量事件'), ...events.map(event => el('article', { class: 'card' }, el('strong', {}, event.type), json(redact(event.payload)), toolMediaView(app.api, event.payload, snapshot?.attachments))))] : []));
        recovery.replaceChildren(...(pending ? [el('p', {}, '发送结果尚未确认。重试会沿用原请求编号，避免重复创建轮次。'),
            button('重试原请求', () => app.run(() => app.retry())),
        ] : []), ...(recoveredDraft ? [button('恢复生成的草稿', () => { draft.value = recoveredDraft; draft.focus(); app.state.recoveredDraft = null; render(); })] : []));
    }
    return { root, render, updateControls, focusMessage(id) {
        const node = messageNodes.get(id);
        if (!node) return false;
        node.scrollIntoView({ block: 'center' }); node.focus(); return true;
    }, clearDraft() { messageRenderKey = null; edits.clear(); attachments = []; attachmentFile.value = ''; memberIds.value = ''; capabilityInfo.textContent = ''; renderAttachments(); draft.value = ''; estimate.replaceChildren(); } };
}
