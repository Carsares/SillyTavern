/**
 * 数据维护标签的「存储占用」和「完整数据导出」两个分区。
 */
const USAGE_LABELS = Object.freeze({
    characters: '角色卡',
    chats: '角色聊天',
    groupChats: '群聊记录',
    groups: '群组',
    worlds: '世界书',
    userImages: '聊天图片',
    files: '聊天附件',
    comfyWorkflows: '绘图工作流',
    user: '用户目录里的其他内容',
    backgrounds: '背景图',
    avatars: '用户头像',
    thumbnailsAvatar: '角色头像缩略图',
    thumbnailsBg: '背景缩略图',
    thumbnailsPersona: '用户头像缩略图',
    thumbnails: '缩略图目录的其他内容',
    backups: '备份与隔离区',
    extensions: '扩展',
    assets: '素材',
    vectors: '向量库',
    novelAI_Settings: 'NovelAI 预设',
    koboldAI_Settings: 'KoboldAI 预设',
    openAI_Settings: 'OpenAI 预设',
    textGen_Settings: 'TextGen 预设',
    themes: '主题',
    movingUI: '界面布局',
    instruct: '指令模板',
    context: '上下文模板',
    quickreplies: '快速回复',
    sysprompt: '系统提示词',
    reasoning: '推理模板',
    other: '其他（设置、密钥等）',
});

export function createMaintenanceStorageComponents(ctx) {
    const { state, escapeHtml, formatBytes, formatNumber } = ctx;

    function renderStorageSection(maintenance) {
        const storage = maintenance.storage;
        const data = storage.data;
        const rows = (data?.entries || []).filter(entry => entry.bytes > 0 || entry.files > 0).sort((a, b) => b.bytes - a.bytes);
        const emptyCount = (data?.entries || []).length - rows.length;
        const maxBytes = rows[0]?.bytes || 1;
        const symlinkCount = (data?.entries || []).reduce((sum, entry) => sum + (entry.symlinks || 0), 0);

        return `
        <section class="panel section-panel" data-maintenance-section="storage">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">存储占用</h2>
                    <p class="panel-subtitle">按目录统计当前账号的数据大小。只读取目录和文件信息，不打开文件，也不会跟随符号链接。</p>
                </div>
                <button class="secondary-button" type="button" data-maintenance-load-usage ${storage.loading ? 'disabled' : ''}>
                    <i class="fa-solid ${storage.loading ? 'fa-circle-notch fa-spin' : 'fa-chart-pie'}"></i>
                    ${data ? '重新统计' : '开始统计'}
                </button>
            </div>
            ${storage.error ? `<p class="danger maintenance-wrap">${escapeHtml(storage.error)}</p>` : ''}
            ${data ? `
                <p class="panel-subtitle">
                    合计 ${escapeHtml(formatBytes(data.totalBytes))} · ${escapeHtml(formatNumber(data.totalFiles))} 个文件
                    ${data.disk ? ` · 磁盘剩余 ${escapeHtml(formatBytes(data.disk.freeBytes))} / ${escapeHtml(formatBytes(data.disk.totalBytes))}` : ''}
                    · 用时 ${escapeHtml(formatNumber(data.durationMs))} 毫秒
                </p>
                ${data.truncated ? '<p class="maintenance-note warning"><i class="fa-solid fa-triangle-exclamation"></i> 目录太大，统计在上限处停止，下面的数字是下限。</p>' : ''}
                <div class="maintenance-table-wrap">
                    <table class="maintenance-table" data-maintenance-usage-table>
                        <thead><tr><th>目录</th><th class="numeric">大小</th><th class="numeric">文件数</th><th class="maintenance-bar-cell"></th></tr></thead>
                        <tbody>
                            ${rows.map(entry => `
                                <tr data-usage-key="${escapeHtml(entry.key)}">
                                    <td>${escapeHtml(USAGE_LABELS[entry.key] || entry.key)}${entry.truncated ? ' <span class="badge">未统计完</span>' : ''}</td>
                                    <td class="numeric">${escapeHtml(formatBytes(entry.bytes))}</td>
                                    <td class="numeric">${escapeHtml(formatNumber(entry.files))}</td>
                                    <td class="maintenance-bar-cell"><span class="maintenance-bar"><span style="width: ${Math.max(1, Math.round(entry.bytes / maxBytes * 100))}%"></span></span></td>
                                </tr>
                            `).join('') || '<tr><td colspan="4" class="muted">没有数据</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <p class="panel-subtitle">
                    ${emptyCount ? `${escapeHtml(formatNumber(emptyCount))} 个空目录未列出。` : ''}
                    ${symlinkCount ? `${escapeHtml(formatNumber(symlinkCount))} 个符号链接已跳过，不计入大小。` : ''}
                </p>
            ` : (storage.loading ? '<p class="panel-subtitle">正在统计…</p>' : '<p class="panel-subtitle">点「开始统计」查看各目录占用。</p>')}
        </section>
    `;
    }

    function renderExportSection(maintenance) {
        const exporting = maintenance.exporting;
        return `
        <section class="panel section-panel" data-maintenance-section="export">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">导出全部数据</h2>
                    <p class="panel-subtitle">把当前账号的整个数据目录（角色、聊天、设置、世界书、素材、备份）打包成一个 zip 下载到本机。文件在浏览器内存里组装，数据量很大时请先看上面的占用。</p>
                </div>
                <button class="secondary-button" type="button" data-maintenance-export ${exporting.busy ? 'disabled' : ''}>
                    <i class="fa-solid ${exporting.busy ? 'fa-circle-notch fa-spin' : 'fa-file-zipper'}"></i>
                    ${exporting.busy ? '正在打包…' : '导出 zip'}
                </button>
            </div>
            ${exporting.error ? `<p class="danger maintenance-wrap" data-maintenance-export-error>${escapeHtml(exporting.error)}</p>` : ''}
            ${exporting.done ? `<p class="success maintenance-wrap">已保存：${escapeHtml(exporting.done)}</p>` : ''}
            <p class="panel-subtitle">当前账号：${escapeHtml(state.me?.handle || '未知')}</p>
        </section>
    `;
    }

    return {
        renderStorageSection,
        renderExportSection,
    };
}
