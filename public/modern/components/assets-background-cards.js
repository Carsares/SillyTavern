export function createAssetBackgroundCardComponents(ctx) {
    const {
        state,
        escapeHtml,
        getBackgroundUrl,
        getBackgroundFilename,
        getBackgroundFoldersFor,
    } = ctx;

    function renderBackgroundCard(background) {
        const filename = getBackgroundFilename(background);
        const isSelected = state.backgroundSelection.filenames.includes(filename);
        const isFocused = state.selected.background === filename;
        const isSelecting = state.backgroundSelection.active;
        const isAnimated = typeof background === 'object' && Boolean(background?.isAnimated);
        const isRenaming = state.backgroundRenaming.filename === filename;
        const folders = getBackgroundFoldersFor(filename);
        const folderText = folders.length ? folders.map(folder => folder.name).join(', ') : '未归档';
        // 批量选择模式下高亮跟随勾选状态；平时高亮当前查看的背景（「上下文」抽屉里显示为当前背景）。
        const highlighted = isSelecting ? isSelected : isFocused;
        const mainTitle = isSelecting
            ? (isSelected ? '点击取消选择' : '点击选择这个背景')
            : (isFocused ? '当前查看的背景，「上下文」抽屉里会显示它' : '点击设为当前查看的背景，「上下文」抽屉里会显示它');

        return `
        <article class="resource-card background-card ${highlighted ? 'selected' : ''}" data-background-card="${escapeHtml(filename)}">
            <button class="background-card-main" type="button" data-focus-background="${escapeHtml(filename)}" aria-pressed="${highlighted ? 'true' : 'false'}" title="${escapeHtml(mainTitle)}">
                <img class="background-thumb" src="${getBackgroundUrl(filename)}" alt="" loading="lazy">
                <span class="card-head">
                    <span>
                        <span class="card-title">${escapeHtml(filename)}</span>
                        <span class="card-meta">${isAnimated ? '动画背景' : '静态背景'} · ${escapeHtml(folderText)}</span>
                    </span>
                    ${isFocused && !isSelecting ? '<span class="tag">查看中</span>' : ''}
                </span>
            </button>
            ${!isSelecting && !isRenaming ? `
                <div class="row-actions">
                    <button class="secondary-button" type="button" data-background-rename="${escapeHtml(filename)}">
                        <i class="fa-solid fa-i-cursor"></i>
                        重命名
                    </button>
                </div>
            ` : ''}
            ${isRenaming ? `
                <div class="settings-form inline-form">
                    <label class="field-label">
                        <span>新文件名</span>
                        <input class="text-input" type="text" data-background-rename-input value="${escapeHtml(state.backgroundRenaming.name)}">
                    </label>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="primary-button" type="button" data-confirm-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid ${state.backgroundRenaming.running ? 'fa-circle-notch fa-spin' : 'fa-check'}"></i>
                            ${state.backgroundRenaming.running ? '保存中' : '保存'}
                        </button>
                    </div>
                </div>
            ` : ''}
            ${isSelecting ? `
                <label class="selection-row">
                    <input type="checkbox" data-background-select="${escapeHtml(filename)}" ${isSelected ? 'checked' : ''}>
                    <span>${isSelected ? '已选择' : '选择'}</span>
                </label>
            ` : ''}
        </article>
    `;
    }

    return {
        renderBackgroundCard,
    };
}
