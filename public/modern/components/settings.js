import { createSettingsPreferenceComponents } from './settings-preferences.js';
import { createSettingsSnapshotComponents } from './settings-snapshots.js';
import { createSettingsStatusComponents } from './settings-status.js';

export function createSettingsComponents(ctx) {
    const {
        state,
        formatNumber,
        metricCard,
        pageHead,
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        showToast,
        render,
    } = ctx;
    let settingsSnapshotAutoLoadPending = false;
    const {
        renderSettingsSnapshots,
    } = createSettingsSnapshotComponents(ctx);
    const {
        renderSettingsPreferencesSection,
    } = createSettingsPreferenceComponents(ctx);
    const {
        renderSettingsStatusSection,
        renderSettingsDiagnosticsSection,
    } = createSettingsStatusComponents(ctx);

    function renderSettings() {
        const bundle = state.settingsBundle || {};
        const requestCompression = getRequestCompressionSettings();
        const savedSecrets = Object.values(state.secretState || {}).filter(value => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
        const snapshotCount = state.settingsSnapshots.loaded ? formatNumber(state.settingsSnapshots.items.length) : '—';
        const compressionEnabled = Boolean(requestCompression.enabled);
        const dataStatus = state.errors.length ? '需要处理' : '正常';
        const activeSection = getSettingsSection();
        ensureSettingsSnapshotsLoaded(activeSection);

        return `
        ${pageHead('设置中心', '账户、扩展、请求压缩和页面偏好。', `
            <button class="primary-button" type="button" data-create-settings-snapshot ${state.settingsSnapshots.creating ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.creating ? 'fa-circle-notch fa-spin' : 'fa-camera'}"></i>
                创建快照
            </button>
            <button class="secondary-button" type="button" data-load-settings-snapshots ${state.settingsSnapshots.loading ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.loading ? 'fa-circle-notch fa-spin' : 'fa-clock-rotate-left'}"></i>
                设置快照
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('数据状态', dataStatus, state.errors.length ? `${formatNumber(state.errors.length)} 个读取错误` : '读取正常', 'fa-heart-pulse')}
            ${metricCard('扩展', formatNumber(state.extensions.length), bundle.enable_extensions ? '扩展系统开启' : '扩展系统关闭', 'fa-cubes')}
            ${metricCard('安全密钥', formatNumber(savedSecrets), '仅显示保存状态', 'fa-key')}
            ${metricCard('设置快照', snapshotCount, getSettingsSnapshotMetricDetail(), 'fa-clock-rotate-left')}
        </div>
        ${renderSettingsTabs(activeSection)}
        ${activeSection === 'preferences' ? renderSettingsPreferencesSection(requestCompression, compressionEnabled) : ''}
        ${activeSection === 'status' ? renderSettingsStatusSection(bundle, savedSecrets, dataStatus, compressionEnabled, requestCompression) : ''}
        ${activeSection === 'snapshots' ? renderSettingsSnapshots() : ''}
        ${activeSection === 'diagnostics' ? renderSettingsDiagnosticsSection(bundle, savedSecrets, dataStatus) : ''}
    `;
    }

    function getSettingsSection() {
        return ['preferences', 'status', 'snapshots', 'diagnostics'].includes(state.settingsSection)
            ? state.settingsSection
            : 'preferences';
    }

    function renderSettingsTabs(activeSection) {
        const tabs = [
            ['preferences', 'fa-sliders', '界面与请求'],
            ['status', 'fa-gauge-high', '账户与资源'],
            ['snapshots', 'fa-clock-rotate-left', '设置快照'],
            ['diagnostics', 'fa-shield-halved', '安全诊断'],
        ];
        return `
        <div class="segmented-control settings-tabs" role="tablist" aria-label="设置分区">
            ${tabs.map(([id, icon, label]) => `
                <button class="${activeSection === id ? 'active' : ''}" type="button" data-settings-section="${id}" aria-selected="${activeSection === id}">
                    <i class="fa-solid ${icon}"></i>
                    ${label}
                </button>
            `).join('')}
        </div>
    `;
    }

    function getSettingsSnapshotMetricDetail() {
        if (state.settingsSnapshots.loading) {
            return '读取中';
        }
        return state.settingsSnapshots.loaded ? '本地备份' : '尚未读取';
    }

    function ensureSettingsSnapshotsLoaded(activeSection) {
        if (activeSection !== 'snapshots' || state.settingsSnapshots.loaded || state.settingsSnapshots.loading || settingsSnapshotAutoLoadPending) {
            return;
        }

        settingsSnapshotAutoLoadPending = true;
        window.setTimeout(async () => {
            try {
                await loadSettingsSnapshots();
                render();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            } finally {
                settingsSnapshotAutoLoadPending = false;
            }
        }, 0);
    }

    return {
        renderSettings,
    };
}
