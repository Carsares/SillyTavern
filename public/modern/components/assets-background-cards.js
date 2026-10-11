export function createAssetBackgroundCardComponents(ctx) {
    const {
        state,
        escapeHtml,
        getBackgroundUrl,
        getBackgroundFilename,
        getBackgroundFoldersFor,
        getChatBackgroundInfo,
        getBackgroundReferenceInfo,
    } = ctx;

    // 整个背景网格共用一份：当前全局背景、当前聊天的锁定和能否写聊天头，每张卡片只做字符串比较
    function createBackgroundCardContext() {
        const info = typeof getChatBackgroundInfo === 'function' ? getChatBackgroundInfo() : null;
        return {
            enabled: Boolean(info),
            globalPath: info?.global?.relativePath || '',
            lockPath: info?.lock?.relativePath || '',
            hasChat: Boolean(info?.target),
            chatLabel: info?.target ? `${info.target.name} / ${info.target.chatId}` : '',
            canEditChat: Boolean(info?.canEdit),
            busy: Boolean(info?.busy),
        };
    }

    // 删除、重命名前提示这些背景是否正被全局设置或当前聊天使用，以及引用会怎么处理
    function renderBackgroundReferenceNote(filenames, mode) {
        if (typeof getBackgroundReferenceInfo !== 'function') {
            return '';
        }

        const references = getBackgroundReferenceInfo(filenames);
        const quote = names => names.map(name => `「${escapeHtml(name)}」`).join('');
        const lines = [];
        if (references.global.length) {
            lines.push(mode === 'delete'
                ? `${quote(references.global)}是当前全局背景，删除后全局背景会恢复为无背景。`
                : '这是当前全局背景，重命名后会同步更新全局设置里的引用。');
        }
        if (references.chat.length) {
            const chat = escapeHtml(references.chatLabel);
            lines.push(mode === 'delete'
                ? `${quote(references.chat)}是当前聊天（${chat}）锁定的背景，删除后会清除这个聊天的背景锁定。`
                : `这是当前聊天（${chat}）锁定的背景，重命名后会同步更新这个聊天的锁定。`);
        }
        lines.push(mode === 'delete'
            ? '其他聊天如果锁定了这些背景，会自动回退到全局背景。'
            : '其他聊天如果锁定了这张背景，会回退到全局背景。');

        return `
        <div class="background-reference-note ${references.global.length || references.chat.length ? 'in-use' : ''}" role="note" data-background-reference-note>
            ${lines.map(line => `<p>${line}</p>`).join('')}
        </div>
    `;
    }

    function renderBackgroundCard(background, cardContext = createBackgroundCardContext()) {
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
        const relativePath = `backgrounds/${filename}`;
        const isGlobalBackground = cardContext.globalPath === relativePath;
        const isChatBackground = cardContext.lockPath === relativePath;
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
            ${isGlobalBackground || isChatBackground ? `
                <div class="tag-row background-usage-tags">
                    ${isGlobalBackground ? '<span class="tag" data-background-usage="global">全局背景</span>' : ''}
                    ${isChatBackground ? '<span class="tag" data-background-usage="chat">聊天锁定</span>' : ''}
                </div>
            ` : ''}
            ${!isSelecting && !isRenaming ? `
                <div class="row-actions">
                    ${cardContext.enabled ? `
                        <button class="secondary-button compact-button" type="button" data-background-set-global="${escapeHtml(filename)}" title="${isGlobalBackground ? '这已经是全局背景' : '把它设为全局背景：没有锁定背景的聊天都会使用它'}" ${isGlobalBackground || cardContext.busy ? 'disabled' : ''}>
                            <i class="fa-solid fa-globe"></i>
                            ${isGlobalBackground ? '当前全局背景' : '设为全局背景'}
                        </button>
                        <button class="secondary-button compact-button" type="button" data-background-set-chat="${escapeHtml(filename)}" title="${escapeHtml(cardContext.hasChat ? (isChatBackground ? '这已经是当前聊天锁定的背景' : `锁定为聊天「${cardContext.chatLabel}」的背景`) : '请先在聊天页选择一个会话')}" ${!cardContext.hasChat || isChatBackground || !cardContext.canEditChat ? 'disabled' : ''}>
                            <i class="fa-solid fa-comment-dots"></i>
                            ${isChatBackground ? '当前聊天背景' : '设为当前聊天背景'}
                        </button>
                    ` : ''}
                    <button class="secondary-button compact-button" type="button" data-background-rename="${escapeHtml(filename)}">
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
                    ${renderBackgroundReferenceNote([filename], 'rename')}
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
        createBackgroundCardContext,
        renderBackgroundCard,
        renderBackgroundReferenceNote,
    };
}
