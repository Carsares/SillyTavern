import { el, button, json } from '../core/dom.js';
import { terminal, redact } from '../core/state.js';
import { runUncertainWrite } from '../core/operations.js';
import { toolMediaView } from '../media/view.js';

export function imageJobState(job, state) {
    const image = job.kind === 'provider-request' && job.dependencies?.kind === 'image';
    const complete = job.payload?.state === 'completed';
    const handle = typeof job.payload?.jobId === 'string' && job.payload.jobId.length > 0;
    const idle = terminal(state.turn) && !state.snapshot?.conversation.activeTurnId;
    return { image, complete, handle, idle, actionable: image && handle && !complete && idle };
}
export function jobView(app, job, reload) {
    const state = imageJobState(job, app.state);
    const feedback = el('div');
    const action = method => app.run(async () => {
        if (app.id() !== job.conversationId || !imageJobState(job, app.state).actionable) throw new Error('仅可在原会话空闲时操作有服务端句柄的未完成图片任务');
        feedback.replaceChildren(el('p', {}, '正在查询或更新现有任务…'));
        try {
            const result = await runUncertainWrite(() => app.api[method](job.conversationId, job.id), reload);
            feedback.replaceChildren(json(redact(result)));
            app.notice(method === 'cancelJob' ? '取消请求已返回；不代表远端已取消，不支持取消时任务仍可能运行。请读取任务状态。' : '已查询现有图片任务；不会提交新任务，也不会改写旧回复。');
            await reload();
        } catch (error) {
            // reload() replaced this card; the unknown outcome goes to the workspace error banner instead.
            if (error.resultUnknown) throw error;
            feedback.replaceChildren(el('p', { role: 'alert', class: 'banner error' }, `任务操作失败：${error.message}。不要重新提交图片生成。`));
        }
    });
    return el('article', { class: 'card' }, el('h3', {}, `${state.image ? '图片任务' : '后台任务'} · ${job.payload?.state ?? job.status ?? '状态未知'}`),
        el('details', {}, el('summary', {}, '任务诊断详情'), json(redact(job))),
        ...(state.image ? [el('p', {}, !state.handle ? '结果未知：没有已持久化的远端任务句柄，不能重新提交。' : state.complete ? '图片任务已完成；结果独立保存，不改写旧回复。' : !state.idle ? '请等待当前生成结束再查询或取消图片任务。' : '只查询现有任务，不重新提交收费请求。'),
            button('查询／恢复已有图片任务', () => action('resumeJob'), !state.actionable),
            button('请求取消已有图片任务', () => action('cancelJob'), !state.actionable),
            toolMediaView(app.api, job.payload?.result, app.state.snapshot?.attachments), feedback] : []));
}
