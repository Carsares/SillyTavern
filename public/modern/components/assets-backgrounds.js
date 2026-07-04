import { createAssetBackgroundCardComponents } from './assets-background-cards.js';
import { createAssetBackgroundFolderComponents } from './assets-background-folders.js';

export function createAssetBackgroundComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        renderInlineEmpty,
        getBackgroundFolderById,
    } = ctx;
    const { renderBackgroundCard } = createAssetBackgroundCardComponents(ctx);
    const { renderBackgroundFoldersPanel } = createAssetBackgroundFolderComponents({
        state,
        escapeHtml,
        formatNumber,
        renderInlineEmpty,
        getBackgroundFolderById,
    });

    function renderBackgroundLibraryPanel(folderFilterName, visibleBackgrounds, totalBackgrounds, selectedCount, selection, hasMoreBackgrounds) {
        const selectionText = selection.active ? `已选择 ${formatNumber(selectedCount)} 个。` : '';
        const subtitle = `${folderFilterName} · 显示 ${formatNumber(visibleBackgrounds.length)} / ${formatNumber(totalBackgrounds)} 个匹配项。${selectionText}`;

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">背景</h2>
                    <p class="panel-subtitle">${escapeHtml(subtitle)}</p>
                </div>
                ${selection.active ? `
                    <div class="panel-actions">
                        <button class="secondary-button" type="button" data-select-visible-backgrounds ${visibleBackgrounds.length ? '' : 'disabled'}>
                            <i class="fa-solid fa-check-double"></i>
                            选择当前显示
                        </button>
                        <button class="secondary-button" type="button" data-clear-background-selection ${selectedCount ? '' : 'disabled'}>
                            <i class="fa-solid fa-xmark"></i>
                            清空选择
                        </button>
                    </div>
                ` : ''}
            </div>
            ${selection.deleteConfirm ? `
                <div class="settings-form inline-form danger-panel">
                    <strong>删除所选背景</strong>
                    <p class="panel-subtitle">将删除 ${formatNumber(selectedCount)} 个背景文件，此操作会调用现有背景删除接口。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid ${selection.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            ${selection.deleting ? '删除中' : '确认删除'}
                        </button>
                    </div>
                </div>
            ` : ''}
            <div class="background-grid">
                ${visibleBackgrounds.map(background => renderBackgroundCard(background)).join('') || renderInlineEmpty('暂无背景')}
            </div>
            ${hasMoreBackgrounds ? `
                <button class="secondary-button load-more-button" type="button" data-load-more-backgrounds>
                    <i class="fa-solid fa-chevron-down"></i>
                    加载更多背景 ${formatNumber(totalBackgrounds - visibleBackgrounds.length)}
                </button>
            ` : ''}
        </section>
    `;
    }

    return {
        renderBackgroundFoldersPanel,
        renderBackgroundLibraryPanel,
    };
}
