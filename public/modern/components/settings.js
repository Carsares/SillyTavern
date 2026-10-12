// 设置中心：模型连接、语言、界面、聊天工具、数据与备份、系统信息六个标签。
// 能改的字段都是改动即保存（actions/settings-autosave.js），页头的状态标签显示最近一次保存的结果。
import { renderSettingsSaveStatus } from '../actions/settings-autosave.js';
import { settingsSectionAliases } from '../core/constants.js';
import { createApiComponents } from './api.js';
import { getSettingsOptionalParts } from './settings-optional-tabs.js';
import { createSettingsLanguageComponents } from './settings-language.js';
import { createSettingsPreferenceComponents } from './settings-preferences.js';
import { createSettingsSnapshotComponents } from './settings-snapshots.js';
import { createSettingsStatusComponents } from './settings-status.js';

export const BUILT_IN_SETTINGS_TABS = Object.freeze([
    Object.freeze({ id: 'connection', icon: 'fa-plug', label: '模型连接' }),
    Object.freeze({ id: 'language', icon: 'fa-language', label: '语言' }),
    Object.freeze({ id: 'preferences', icon: 'fa-palette', label: '界面' }),
    Object.freeze({ id: 'data', icon: 'fa-database', label: '数据与备份' }),
    Object.freeze({ id: 'system', icon: 'fa-circle-info', label: '系统信息' }),
]);

/**
 * @param {string} section 标签 id，可能是旧版的
 * @returns {string} 合并后的标签 id
 */
export function normalizeSettingsSection(section) {
    return settingsSectionAliases[section] || section;
}

/**
 * 当前可用的标签，按标签条顺序。
 * @param {ReturnType<typeof getSettingsOptionalParts>} optionalParts 可选部分
 * @returns {{ id: string, icon: string, label: string }[]} 标签
 */
export function getSettingsTabs(optionalParts) {
    const optionalTabs = optionalParts.tabs.filter(tab => tab.isAvailable());
    return BUILT_IN_SETTINGS_TABS.flatMap(tab => [tab, ...optionalTabs.filter(optional => optional.after === tab.id)]);
}

export function createSettingsComponents(ctx) {
    const {
        state,
        pageHead,
        escapeHtml,
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        showToast,
        render,
    } = ctx;
    let settingsSnapshotAutoLoadPending = false;
    // A failed automatic read is not retried on every render; the「刷新」button reads again
    let settingsSnapshotAutoLoadFailed = false;
    const { renderConnectionTab } = createApiComponents(ctx);
    const { renderSettingsSnapshots } = createSettingsSnapshotComponents(ctx);
    const { renderSettingsPreferencesSection } = createSettingsPreferenceComponents(ctx);
    const { renderSettingsLanguageSection } = createSettingsLanguageComponents(ctx);
    const { renderSettingsSystemSection } = createSettingsStatusComponents(ctx);
    // 「聊天工具」标签和数据维护分区：对应面板报告可用时才出现，见 settings-optional-tabs.js
    const optionalParts = getSettingsOptionalParts(ctx);

    function renderSettings() {
        const tabs = getSettingsTabs(optionalParts);
        const activeSection = getSettingsSection(tabs);
        // 每次渲染都问一遍数据维护是否可用：它借这个机会在离开「数据与备份」后作废没做完的清理报告（见 settings-maintenance.js）
        const maintenanceAvailable = optionalParts.maintenance.isAvailable();

        return `
        ${pageHead('设置中心', '模型连接、语言、界面、聊天工具和数据备份都在这里，改动会自动保存。', renderSettingsSaveStatus(state.settingsAutosave, escapeHtml))}
        ${renderSettingsTabs(tabs, activeSection)}
        <div class="settings-tab-body" data-settings-panel="${escapeHtml(activeSection)}">
            ${renderSection(activeSection, maintenanceAvailable)}
        </div>
    `;
    }

    function renderSection(section, maintenanceAvailable) {
        if (section === 'connection') {
            return renderConnectionTab();
        }
        if (section === 'language') {
            return renderSettingsLanguageSection();
        }
        if (section === 'preferences') {
            return renderSettingsPreferencesSection();
        }
        if (section === 'data') {
            return renderDataSection(maintenanceAvailable);
        }
        if (section === 'system') {
            const savedSecrets = Object.values(state.secretState || {}).filter(value => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
            return renderSettingsSystemSection(state.settingsBundle || {}, savedSecrets, getRequestCompressionSettings());
        }
        return optionalParts.tabs.find(tab => tab.id === section)?.render() || '';
    }

    function getSettingsSection(tabs) {
        const section = normalizeSettingsSection(state.settingsSection);
        return tabs.some(tab => tab.id === section) ? section : tabs[0].id;
    }

    function renderSettingsTabs(tabs, activeSection) {
        return `
        <div class="segmented-control settings-tabs" role="tablist" aria-label="设置分区">
            ${tabs.map(({ id, icon, label }) => `
                <button class="${activeSection === id ? 'active' : ''}" type="button" role="tab" data-settings-section="${id}" aria-selected="${activeSection === id}">
                    <i class="fa-solid ${icon}"></i>
                    ${label}
                </button>
            `).join('')}
        </div>
    `;
    }

    function renderDataSection(maintenanceAvailable) {
        ensureSettingsSnapshotsLoaded();
        return `
        <div class="settings-data">
            ${renderSettingsSnapshots(maintenanceAvailable ? optionalParts.maintenance : null)}
            ${renderRawSettingsEditorSection()}
            ${maintenanceAvailable ? optionalParts.maintenance.renderPanel() : ''}
        </div>
    `;
    }

    // 打开「数据与备份」时读取一次快照列表
    function ensureSettingsSnapshotsLoaded() {
        if (state.settingsSnapshots.loaded || state.settingsSnapshots.loading || settingsSnapshotAutoLoadPending || settingsSnapshotAutoLoadFailed) {
            return;
        }

        settingsSnapshotAutoLoadPending = true;
        window.setTimeout(async () => {
            try {
                await loadSettingsSnapshots();
                render();
            } catch (error) {
                settingsSnapshotAutoLoadFailed = true;
                state.settingsSnapshots.error = error.message;
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            } finally {
                settingsSnapshotAutoLoadPending = false;
            }
        }, 0);
    }

    function renderRawSettingsEditorSection() {
        const editor = state.rawSettingsEditor;
        if (!editor.open) {
            return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">原始设置</h2>
                    <p class="panel-subtitle">直接编辑完整的 settings.json，用来修改界面上没有的高级设置。保存前会自动创建快照，改错了可以在上面恢复。</p>
                </div>
                <button class="secondary-button" type="button" data-open-raw-settings>
                    <i class="fa-solid fa-file-code"></i>
                    打开编辑器
                </button>
            </div>
        </section>
    `;
        }

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">原始设置</h2>
                    <p class="panel-subtitle">编辑完整的 settings.json。这里需要手动保存：保存前自动创建快照，写入后生成引擎会自动重载。</p>
                </div>
            </div>
            ${editor.loading
        ? '<p class="panel-subtitle"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在加载当前设置…</p>'
        : `<textarea class="preset-json-editor" spellcheck="false" data-raw-settings-input ${editor.saving ? 'disabled' : ''}>${escapeHtml(editor.value)}</textarea>`}
            ${editor.error ? `<p class="danger">${escapeHtml(editor.error)}</p>` : ''}
            <div class="message-edit-actions">
                <button class="primary-button" type="button" data-save-raw-settings ${editor.loading || editor.saving ? 'disabled' : ''}>
                    <i class="fa-solid ${editor.saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}"></i>
                    保存并快照
                </button>
                <button class="secondary-button" type="button" data-cancel-raw-settings ${editor.saving ? 'disabled' : ''}>
                    <i class="fa-solid fa-xmark"></i>
                    关闭
                </button>
            </div>
        </section>
    `;
    }

    return {
        renderSettings,
    };
}
