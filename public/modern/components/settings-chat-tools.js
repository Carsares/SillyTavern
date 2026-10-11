/**
 * 设置页「聊天工具」标签：把若干分区按顺序排在一页里，没有任何分区可用时这个标签不出现（见 settings-optional-tabs.js）。
 *
 * 分区文件格式固定为 { id, label, isAvailable(): boolean, render(): string }，render() 返回完整的 <section class="form-section">：
 *   translate   components/settings-tool-translate.js   B3 翻译设置
 *   summary     components/settings-tool-summary.js     A6 聊天摘要设置
 *   reasoning   components/settings-tool-reasoning.js   A2 推理解析设置
 * 分区的事件写在 routes/settings-tool-<分区>-events.js，由 routes/settings-chat-tools-events.js 转发；
 * 业务动作的注册方式见 components/chat-tools.js 顶部注释（同一个路由上下文，设置页也能直接解构到）。
 */
import { resolveSlotAvailability } from '../core/test-flags.js';
import { createSettingsToolReasoning } from './settings-tool-reasoning.js';
import { createSettingsToolSummary } from './settings-tool-summary.js';
import { createSettingsToolTranslate } from './settings-tool-translate.js';

// 分区在页面上的排列顺序
const settingsToolSectionFactories = [
    createSettingsToolTranslate,
    createSettingsToolReasoning,
    createSettingsToolSummary,
];

export function createSettingsChatToolsComponents(ctx) {
    const sections = settingsToolSectionFactories.map(createSection => createSection(ctx));

    function getAvailableSections() {
        return sections.filter(section => resolveSlotAvailability('settingsToolSections', section.id, section.isAvailable()));
    }

    function isAvailable() {
        return getAvailableSections().length > 0;
    }

    function renderSettingsChatToolsPanel() {
        return `
        <section class="panel section-panel" data-settings-chat-tools>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">聊天工具设置</h2>
                    <p class="panel-subtitle">翻译、摘要和推理解析等聊天辅助功能的设置。</p>
                </div>
            </div>
            <div class="settings-tool-sections">
                ${getAvailableSections().map(section => `<div data-settings-tool-section="${section.id}">${section.render()}</div>`).join('')}
            </div>
        </section>
    `;
    }

    return {
        isAvailable,
        renderSettingsChatToolsPanel,
    };
}
