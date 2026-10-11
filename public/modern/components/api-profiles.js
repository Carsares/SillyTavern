import { renderSwitchResult } from './chat-connection-chip.js';
import {
    describeProfile,
    getSwitchBlocker,
    getSwitcherState,
    readConnectionManager,
} from '../actions/connection-profiles.js';

export function createApiProfileComponents(ctx) {
    const {
        state,
        escapeHtml,
        renderKeyValue,
    } = ctx;

    function renderConnectionProfileCard(profile, { selectedProfile, deleteConfirmId, blocker }) {
        const view = describeProfile(profile);
        const current = view.id === selectedProfile;
        const confirmingDelete = deleteConfirmId === view.id;
        const idAttribute = escapeHtml(view.id);
        return `
        <article class="resource-card connection-profile-card${current ? ' is-current' : ''}" data-connection-profile-card="${idAttribute}">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(view.name)}</h3>
                    <div class="card-meta">${escapeHtml(view.modeLabel)}</div>
                </div>
                ${current ? '<span class="badge active">当前</span>' : ''}
            </div>
            <div class="kv-list">
                ${renderKeyValue('来源', view.sourceLabel, { emptyText: '未记录' })}
                ${renderKeyValue('模型', view.model, { emptyText: '未记录' })}
                ${renderKeyValue('预设', view.preset, { emptyText: '未记录' })}
                ${renderKeyValue('地址', view.endpoint, { emptyText: '未记录' })}
                ${view.proxy ? renderKeyValue('代理预设', view.proxy) : ''}
                ${view.excludedLabels.length ? renderKeyValue('不包含', view.excludedLabels.join('、')) : ''}
            </div>
            ${confirmingDelete ? `
                <div class="connection-profile-confirm" role="group" aria-label="确认删除档案">
                    <span>确定删除“${escapeHtml(view.name)}”？不会改动当前的连接设置。</span>
                    <div class="connection-profile-actions">
                        <button class="secondary-button compact-button danger-action" type="button" data-api-connection-profile-delete-confirm="${idAttribute}">删除</button>
                        <button class="secondary-button compact-button" type="button" data-api-connection-profile-delete-cancel>取消</button>
                    </div>
                </div>
            ` : `
                <div class="connection-profile-actions">
                    <button class="primary-button compact-button" type="button" data-api-connection-profile-apply="${idAttribute}" ${blocker ? 'disabled' : ''} title="${escapeHtml(blocker || (current ? '重新应用这个档案' : '应用这个档案'))}">
                        <i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i>
                        ${current ? '重新应用' : '应用'}
                    </button>
                    <button class="secondary-button compact-button danger-action" type="button" data-api-connection-profile-delete="${idAttribute}">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        删除
                    </button>
                </div>
            `}
        </article>
    `;
    }

    function renderConnectionProfileCreateForm(switcher, blocker) {
        return `
        <form class="inline-form connection-profile-create" data-connection-profile-create-form novalidate>
            <label class="field-label">
                <span>档案名称</span>
                <input class="text-input" type="text" maxlength="80" autocomplete="off" data-api-connection-create-name value="${escapeHtml(switcher.createName)}" ${switcher.error ? 'aria-invalid="true" aria-describedby="api-connection-create-error"' : ''}>
            </label>
            ${switcher.error ? `<p class="field-error" id="api-connection-create-error" role="alert" data-api-connection-error>${escapeHtml(switcher.error)}</p>` : ''}
            <p class="panel-subtitle">记录当前的来源、模型、预设、地址、代理和停止字符串等设置；密钥只记录当前启用的是哪一个，不会写入明文。</p>
            <div class="connection-profile-actions">
                <button class="primary-button compact-button" type="submit" ${blocker ? 'disabled' : ''}>保存档案</button>
                <button class="secondary-button compact-button" type="button" data-api-connection-create-cancel>取消</button>
            </div>
        </form>
    `;
    }

    // 旧版连接管理扩展保存的真实档案：列表、应用、删除和从当前连接创建。聊天输入框旁的连接标签读写同一份数据
    function renderConnectionProfilesSection() {
        const switcher = getSwitcherState(state);
        const { profiles, selectedProfile } = readConnectionManager(state.settings || {});
        const blocker = getSwitchBlocker(state);
        const createButton = `
            <button class="secondary-button" type="button" data-api-connection-profile-create-open ${switcher.busy ? 'disabled' : ''}>
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                从当前连接创建档案
            </button>
        `;
        return `
        <section class="panel section-panel connection-profiles" data-connection-profiles>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">把来源、模型、预设、地址等存成一组，在这里或聊天输入框旁一键切换。预设、代理按名称精确匹配，找不到的项会跳过并说明原因。</p>
                </div>
                <div class="panel-actions">
                    ${switcher.createOpen ? '' : createButton}
                </div>
            </div>
            ${switcher.createOpen ? renderConnectionProfileCreateForm(switcher, switcher.busy ? '正在切换连接' : '') : ''}
            ${blocker ? `<p class="connection-profiles-note" role="status">${escapeHtml(blocker)}，暂时不能应用档案。</p>` : ''}
            ${profiles.length ? `
                <div class="grid-list">
                    ${profiles.map(profile => renderConnectionProfileCard(profile, { selectedProfile, deleteConfirmId: switcher.deleteConfirmId, blocker })).join('')}
                </div>
            ` : `
                <div class="connection-profiles-empty">
                    <i class="fa-solid fa-plug-circle-plus" aria-hidden="true"></i>
                    <strong>还没有连接档案</strong>
                    <span>上面的连接改动会自动保存。配好后点“从当前连接创建档案”，之后可以在这里或聊天输入框旁一键切换。</span>
                </div>
            `}
            ${switcher.lastResult ? renderSwitchResult(switcher.lastResult, { dismissAttribute: 'data-api-connection-result-dismiss' }) : ''}
        </section>
    `;
    }

    return {
        renderConnectionProfilesSection,
    };
}
