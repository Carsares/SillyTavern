import { createPresetDetailComponents } from './preset-details.js';

export function createPresetsComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        getPresetCount,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
    } = ctx;
    const { renderPresetDetail } = createPresetDetailComponents(ctx);

    function renderPresets() {
        const groups = getVisiblePresetGroups();
        const selected = getSelectedPresetRecord(groups);
        const visibleCount = groups.reduce((total, group) => total + group.items.length, 0);

        return `
        ${pageHead('预设管理', '模型参数、指令模板和上下文模板。', `
            <label class="secondary-button file-action">
                <i class="fa-solid fa-file-import"></i>
                导入到当前类型
                <input class="visually-hidden" type="file" accept=".json,application/json" data-preset-import-file>
            </label>
        `)}
        <div class="preset-workspace">
            <section class="panel preset-browser">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">预设库</h2>
                        <p class="panel-subtitle">显示 ${formatNumber(visibleCount)} / ${formatNumber(getPresetCount())} 个预设。</p>
                    </div>
                    <span class="badge">${groups.length ? `${formatNumber(groups.length)} 类` : '无结果'}</span>
                </div>
                <div class="preset-group-list">
                    ${groups.map(group => renderPresetGroup(group, selected?.group.id)).join('') || renderInlineEmpty('暂无匹配预设')}
                </div>
            </section>
            <section class="panel preset-detail">
                ${selected ? renderPresetDetail(selected.group, selected.preset) : renderEmptyState('fa-sliders', '暂无匹配预设', '尝试清空搜索关键词。')}
            </section>
        </div>
    `;
    }

    function renderPresetGroup(group, selectedGroupId) {
        return `
        <details class="preset-group" ${group.id === selectedGroupId ? 'open' : ''}>
            <summary>
                <span>
                    <strong>${escapeHtml(group.label)}</strong>
                    <em>${escapeHtml(group.id)}</em>
                </span>
                <span class="badge">${formatNumber(group.items.length)}</span>
            </summary>
            <div class="resource-list preset-list">
                ${group.items.map(item => renderPresetRow(group, item)).join('')}
            </div>
        </details>
    `;
    }

    function renderPresetRow(group, item) {
        const selected = state.presetSelection.apiId === group.id && state.presetSelection.name === item.name;

        return `
        <button class="resource-row ${selected ? 'active' : ''}" type="button" data-select-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
            <span class="avatar-fallback"><i class="fa-solid fa-file-lines"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(item.name)}</span>
                <span class="row-subtitle">${escapeHtml(getPresetSummary(item.content))}</span>
            </span>
            ${item.active ? '<span class="badge">当前</span>' : ''}
        </button>
    `;
    }

    function getPresetSummary(rawPreset) {
        if (!rawPreset) {
            return '预设文件';
        }

        if (typeof rawPreset === 'string') {
            try {
                const preset = JSON.parse(rawPreset);
                return preset.model || preset.openai_model || preset.name || 'JSON 预设';
            } catch {
                return '文本预设';
            }
        }

        return rawPreset.model || rawPreset.name || 'JSON 预设';
    }

    return {
        renderPresets,
    };
}
