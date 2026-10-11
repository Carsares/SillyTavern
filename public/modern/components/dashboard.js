import { getEffectiveConnection, withRawValue } from '../core/connection-labels.js';
import { createDashboardResourceComponents } from './dashboard-resources.js';

export function createDashboardComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderKeyValue,
        getPresetCount,
        getProviderInfo,
    } = ctx;
    const { renderDashboardResourceList } = createDashboardResourceComponents(ctx);

    function renderDashboard() {
        const provider = getProviderInfo();
        const connection = getEffectiveConnection(state.settings || {}, provider);
        const connectionIssues = getConnectionIssues(connection);

        return `
        ${pageHead('工作台', '资源、连接和最近会话。', `
            <button class="primary-button" type="button" data-route="chat">
                <i class="fa-solid fa-comments"></i>
                进入聊天
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('角色', formatNumber(state.characters.length), '可用于聊天和人设转换', 'fa-address-card')}
            ${metricCard('群组', formatNumber(state.groups.length), '多人会话和发言策略', 'fa-users')}
            ${metricCard('世界书', formatNumber(state.worldbooks.length || provider.worldCount), '上下文知识库', 'fa-book-open')}
            ${metricCard('预设', formatNumber(getPresetCount()), '模型、指令、上下文模板', 'fa-sliders')}
        </div>
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle">从现有设置读取，不展示任何密钥。</p>
                    </div>
                    <button class="secondary-button" type="button" data-route="api">
                        <i class="fa-solid fa-plug-circle-check"></i>
                        检查连接
                    </button>
                </div>
                <div class="kv-list connection-summary-list">
                    ${renderConnectionRow(connection)}
                    ${renderKeyValue('主 API', withRawValue(connection.mainApiLabel, connection.mainApi) || '未选择')}
                    ${renderKeyValue('来源', withRawValue(connection.sourceLabel, connection.source) || '未配置')}
                    ${renderKeyValue('模型', connection.model || '未读取到模型字段')}
                    ${renderKeyValue('预设字段', provider.preset || '未读取到当前预设字段')}
                </div>
                ${renderConnectionIssues(connectionIssues)}
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">资源概览</h2>
                        <p class="panel-subtitle">优先显示需要经常操作的对象。</p>
                    </div>
                </div>
                <div class="resource-list">
                    ${renderDashboardResourceList()}
                </div>
            </section>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">快捷入口</h2>
                    <p class="panel-subtitle">按常用工作流进入对应页面。</p>
                </div>
            </div>
            <div class="action-grid">
                ${renderActionCard('聊天', '查看角色会话和历史消息', `${formatNumber(state.characters.length)} 个角色`, 'fa-comments', 'chat')}
                ${renderActionCard('角色', '检查角色卡和关联世界书', `${formatNumber(state.characters.length)} 张卡`, 'fa-address-card', 'characters')}
                ${renderActionCard('群组', '维护成员和群聊策略', `${formatNumber(state.groups.length)} 个群组`, 'fa-users', 'groups')}
                ${renderActionCard('世界书', '查看知识库文件和条目', `${formatNumber(state.worldbooks.length || provider.worldCount)} 本`, 'fa-book-open', 'worldbooks')}
                ${renderActionCard('预设', '浏览模型参数和提示模板', `${formatNumber(getPresetCount())} 个`, 'fa-sliders', 'presets')}
                ${renderActionCard('API', '检查连接、模型和密钥状态', connection.sourceLabel || connection.label, 'fa-plug', 'api')}
                ${renderActionCard('活动', '查看聊天统计和最近活动', '统计缓存', 'fa-chart-line', 'activity')}
                ${renderActionCard('扩展', '查看已发现扩展', `${formatNumber(state.extensions.length)} 个`, 'fa-cubes', 'extensions')}
            </div>
        </section>
    `;
    }

    // Text completion always resolves a type and the other main APIs have no source id, so only an
    // unselected or chat-completion main API can be missing its source
    function getConnectionIssues(connection) {
        const issues = [];
        if (!connection.mainApi) {
            issues.push('主 API 未选择');
        }
        if ((!connection.mainApi || connection.mainApi === 'openai') && !connection.source) {
            issues.push('聊天补全来源未配置');
        }
        if (connection.mainApi === 'kobold' && !connection.endpoint) {
            issues.push('KoboldAI 服务地址未配置');
        }
        if (!connection.model) {
            issues.push('模型未配置');
        }
        return issues;
    }

    // The effective provider leads the card; the raw settings values stay in the tooltip
    function renderConnectionRow(connection) {
        return `
        <div class="kv-row">
            <span class="kv-key">当前连接</span>
            <span class="kv-value" title="${escapeHtml(connection.title)}">${escapeHtml(connection.label)}</span>
        </div>
    `;
    }

    function renderConnectionIssues(issues) {
        if (!issues.length) {
            return '';
        }

        return `
        <div class="dashboard-connection-warning">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>连接配置不完整：${escapeHtml(issues.join('、'))}</span>
            <button class="secondary-button" type="button" data-route="api">打开 API</button>
        </div>
    `;
    }

    function renderActionCard(title, detail, meta, icon, routeId) {
        return `
        <button class="action-card" type="button" data-route="${routeId}">
            <span class="action-icon"><i class="fa-solid ${icon}"></i></span>
            <span class="action-body">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(detail)}</span>
            </span>
            <span class="badge" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
        </button>
    `;
    }

    return {
        renderDashboard,
    };
}
