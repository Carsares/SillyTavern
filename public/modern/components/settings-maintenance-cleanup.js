/**
 * 数据维护标签的两个清理类分区：未引用文件清理（Data Maid）和重复的仅开场白会话。
 * 两者都遵守同一套流程：扫描出明细 → 勾选 → 「删除/隔离所选」只打开确认框 → 确认后才发请求。
 */
import { DATA_MAID_CATEGORIES, DATA_MAID_MAX_ROWS, describeDataMaidSkip, describeGreetingSkip } from '../actions/maintenance.js';

export function createMaintenanceCleanupComponents(ctx) {
    const { escapeHtml, formatBytes, formatNumber } = ctx;

    function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
    }

    function formatAge(timestamp) {
        const minutes = Math.floor((Date.now() - timestamp) / 60000);
        return minutes < 1 ? '刚刚' : `${formatNumber(minutes)} 分钟前`;
    }

    // ------------------------------------------------------------ Data Maid

    function renderDataMaidRow(row, category, dataMaid) {
        const skipReason = dataMaid.skipped[row.hash];
        const isSelected = dataMaid.selected.includes(row.hash);
        const isPreviewing = dataMaid.preview?.hash === row.hash;
        return `
        <div class="maintenance-row ${isSelected ? 'selected' : ''} ${skipReason ? 'skipped' : ''}" data-maintenance-data-maid-row="${escapeHtml(row.hash)}">
            <input type="checkbox" data-maintenance-data-maid-item="${escapeHtml(row.hash)}" aria-label="选择 ${escapeHtml(row.name)}" ${isSelected ? 'checked' : ''} ${skipReason || dataMaid.deleting ? 'disabled' : ''}>
            <span class="row-main">
                <span class="row-title" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
                <span class="row-subtitle">${[
        row.parent ? `目录 ${escapeHtml(row.parent)}` : '',
        row.size !== undefined ? escapeHtml(formatBytes(row.size)) : '',
        row.mtime ? `修改于 ${escapeHtml(formatTime(row.mtime))}` : '',
    ].filter(Boolean).join(' · ')}</span>
                ${skipReason ? `<span class="row-subtitle warning-text">${escapeHtml(describeDataMaidSkip(skipReason))}</span>` : ''}
            </span>
            <button class="secondary-button" type="button" data-maintenance-data-maid-preview="${escapeHtml(row.hash)}" ${isPreviewing && dataMaid.preview?.loading ? 'disabled' : ''}>
                <i class="fa-solid fa-eye"></i>
                预览
            </button>
        </div>
    `;
    }

    function renderDataMaidCategory(info, dataMaid) {
        const rows = dataMaid.report?.[info.key] || [];
        if (info.managedElsewhere) {
            return `
            <div class="maintenance-category managed-elsewhere" data-maintenance-category="${info.key}">
                <div class="maintenance-category-head">
                    <span class="row-main">
                        <span class="row-title">${escapeHtml(info.label)}</span>
                        <span class="row-subtitle">${escapeHtml(formatNumber(rows.length))} 个 · ${escapeHtml(info.managedElsewhere)}</span>
                    </span>
                    <span class="badge">不在这里清理</span>
                </div>
            </div>
        `;
        }
        if (!rows.length) {
            return '';
        }

        const displayed = rows.slice(0, DATA_MAID_MAX_ROWS);
        const totalBytes = rows.reduce((sum, row) => sum + (row.size || 0), 0);
        const selectableHashes = displayed.filter(row => !dataMaid.skipped[row.hash]).map(row => row.hash);
        const selectedInCategory = selectableHashes.filter(hash => dataMaid.selected.includes(hash)).length;
        const allSelected = selectableHashes.length > 0 && selectedInCategory === selectableHashes.length;
        const isExpanded = dataMaid.expanded.includes(info.key);

        return `
        <div class="maintenance-category ${info.danger ? 'danger-category' : ''}" data-maintenance-category="${info.key}">
            <div class="maintenance-category-head">
                <input type="checkbox" data-maintenance-data-maid-category="${info.key}" aria-label="选择「${escapeHtml(info.label)}」中显示的全部文件" ${allSelected ? 'checked' : ''} ${dataMaid.deleting ? 'disabled' : ''}>
                <span class="row-main">
                    <span class="row-title">${escapeHtml(info.label)}</span>
                    <span class="row-subtitle">${escapeHtml(info.hint)}</span>
                </span>
                <span class="badge ${info.danger ? 'danger' : ''}">${escapeHtml(formatNumber(rows.length))} 个 · ${escapeHtml(formatBytes(totalBytes))}</span>
                <button class="icon-button" type="button" data-maintenance-data-maid-expand="${info.key}" aria-expanded="${isExpanded}" aria-label="${isExpanded ? '收起' : '展开'}${escapeHtml(info.label)}">
                    <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
                </button>
            </div>
            ${info.warning ? `<p class="maintenance-note danger-note"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(info.warning)}</p>` : ''}
            ${isExpanded ? `
                <div class="maintenance-rows">
                    ${displayed.map(row => renderDataMaidRow(row, info.key, dataMaid)).join('')}
                </div>
                ${rows.length > displayed.length ? `<p class="panel-subtitle">只显示前 ${formatNumber(DATA_MAID_MAX_ROWS)} 项，类别复选框也只选中这些。清理后重新扫描可以处理剩下的 ${escapeHtml(formatNumber(rows.length - displayed.length))} 项。</p>` : ''}
            ` : ''}
        </div>
    `;
    }

    function renderDataMaidPreview(dataMaid) {
        const preview = dataMaid.preview;
        if (!preview) {
            return '';
        }
        const row = Object.values(dataMaid.report || {}).flat().find(item => item.hash === preview.hash);
        return `
        <div class="maintenance-preview" data-maintenance-data-maid-preview-pane>
            <div class="panel-header compact-header">
                <div>
                    <h3 class="panel-title">${escapeHtml(row?.name || '预览')}</h3>
                    <p class="panel-subtitle">只读预览，不会改动文件。</p>
                </div>
                <button class="secondary-button" type="button" data-maintenance-data-maid-preview-close><i class="fa-solid fa-xmark"></i> 关闭预览</button>
            </div>
            ${preview.loading ? '<p class="panel-subtitle"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在读取…</p>' : ''}
            ${preview.error ? `<p class="danger maintenance-wrap">${escapeHtml(preview.error)}</p>` : ''}
            ${preview.kind === 'image' ? `<img class="maintenance-preview-image" src="${escapeHtml(preview.url)}" alt="${escapeHtml(row?.name || '预览')}">` : ''}
            ${preview.kind === 'text' ? `<pre class="maintenance-preview-text">${escapeHtml(preview.text)}${preview.truncated ? '\n…（只显示开头）' : ''}</pre>` : ''}
            ${preview.kind === 'binary' ? `<p class="panel-subtitle">这个文件不是图片或文本，无法预览（${escapeHtml(formatBytes(preview.size))}）。</p>` : ''}
        </div>
    `;
    }

    function renderDataMaidConfirm(dataMaid) {
        const selected = new Set(dataMaid.selected);
        const rows = Object.entries(dataMaid.report || {}).flatMap(([category, categoryRows]) => categoryRows
            .filter(row => selected.has(row.hash))
            .map(row => ({ ...row, category })));
        const perCategory = DATA_MAID_CATEGORIES
            .map(info => {
                const inCategory = rows.filter(row => row.category === info.key);
                return { info, count: inCategory.length, bytes: inCategory.reduce((sum, row) => sum + (row.size || 0), 0) };
            })
            .filter(entry => entry.count > 0);
        const totalBytes = rows.reduce((sum, row) => sum + (row.size || 0), 0);
        const dangerLabels = perCategory.filter(entry => entry.info.danger).map(entry => entry.info.label);

        return `
        <div class="maintenance-confirm danger-confirm" data-maintenance-data-maid-confirm-box role="alertdialog" aria-label="确认永久删除">
            <p><strong>将永久删除 ${escapeHtml(formatNumber(rows.length))} 个文件（${escapeHtml(formatBytes(totalBytes))}），不会进回收站，无法恢复。</strong></p>
            <ul>
                ${perCategory.map(entry => `<li>${escapeHtml(entry.info.label)}：${escapeHtml(formatNumber(entry.count))} 个 · ${escapeHtml(formatBytes(entry.bytes))}</li>`).join('')}
            </ul>
            ${dangerLabels.length ? `<p class="danger maintenance-wrap"><i class="fa-solid fa-triangle-exclamation"></i> 其中包含「${escapeHtml(dangerLabels.join('」「'))}」。请确认这些文件你确实不需要，尤其是可能手动上传的图片和完整的聊天记录。</p>` : ''}
            <p class="panel-subtitle">删除时服务器会重新核对：扫描后被改动或已被引用的文件会自动跳过，并在结果里列出。</p>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-maintenance-data-maid-delete-cancel ${dataMaid.deleting ? 'disabled' : ''}>取消</button>
                <button class="secondary-button danger-action" type="button" data-maintenance-data-maid-delete-confirm ${dataMaid.deleting ? 'disabled' : ''}>
                    <i class="fa-solid ${dataMaid.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                    确认永久删除
                </button>
            </div>
        </div>
    `;
    }

    function renderDataMaidResult(dataMaid) {
        const result = dataMaid.result;
        if (!result) {
            return '';
        }
        return `
        <div class="maintenance-result" data-maintenance-data-maid-result>
            <p><strong>已删除 ${escapeHtml(formatNumber(result.deleted.length))} 个文件，释放 ${escapeHtml(formatBytes(result.freedBytes))}。</strong></p>
            ${result.skipped.length ? `
                <p class="warning-text">${escapeHtml(formatNumber(result.skipped.length))} 个没有删除：</p>
                <ul>${result.skipped.slice(0, 50).map(item => `<li>${escapeHtml(item.name)}：${escapeHtml(describeDataMaidSkip(item.reason))}</li>`).join('')}</ul>
                ${result.skipped.length > 50 ? `<p class="panel-subtitle">还有 ${escapeHtml(formatNumber(result.skipped.length - 50))} 个未列出。</p>` : ''}
            ` : ''}
        </div>
    `;
    }

    function renderDataMaidSection(maintenance) {
        const dataMaid = maintenance.dataMaid;
        const report = dataMaid.report;
        const selectedRows = report ? Object.entries(report)
            .filter(([category]) => !DATA_MAID_CATEGORIES.find(info => info.key === category)?.managedElsewhere)
            .flatMap(([, rows]) => rows.filter(row => dataMaid.selected.includes(row.hash))) : [];
        const selectedBytes = selectedRows.reduce((sum, row) => sum + (row.size || 0), 0);
        const hasAnyLoose = report && DATA_MAID_CATEGORIES.some(info => !info.managedElsewhere && report[info.key]?.length);

        return `
        <section class="panel section-panel" data-maintenance-section="data-maid">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">未引用文件清理</h2>
                    <p class="panel-subtitle">找出没有被任何聊天、角色或设置引用的文件。先扫描、再逐类查看明细，勾选后确认才会删除；删除是永久的。</p>
                </div>
                <div class="row-actions">
                    ${report ? '<button class="secondary-button" type="button" data-maintenance-release-data-maid><i class="fa-solid fa-xmark"></i> 关闭报告</button>' : ''}
                    <button class="secondary-button" type="button" data-maintenance-scan-data-maid ${dataMaid.loading || dataMaid.deleting ? 'disabled' : ''}>
                        <i class="fa-solid ${dataMaid.loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'}"></i>
                        ${report ? '重新扫描' : '开始扫描'}
                    </button>
                </div>
            </div>
            ${dataMaid.error ? `<p class="danger maintenance-wrap">${escapeHtml(dataMaid.error)}</p>` : ''}
            ${dataMaid.loading ? '<p class="panel-subtitle"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在扫描，聊天较多时可能要几十秒…</p>' : ''}
            ${report ? `
                <p class="panel-subtitle">扫描于 ${escapeHtml(formatAge(dataMaid.scannedAt))}。报告超过 10 分钟后需要重新扫描才能删除。离开本标签时报告会自动关闭。</p>
                ${hasAnyLoose ? '' : '<p class="success maintenance-wrap"><i class="fa-solid fa-circle-check"></i> 没有发现可清理的未引用文件。</p>'}
                <div class="maintenance-categories">
                    ${DATA_MAID_CATEGORIES.map(info => renderDataMaidCategory(info, dataMaid)).join('')}
                </div>
                ${renderDataMaidPreview(dataMaid)}
                ${hasAnyLoose ? `
                    <div class="maintenance-action-bar">
                        <span class="panel-subtitle" data-maintenance-data-maid-selected>已选 ${escapeHtml(formatNumber(selectedRows.length))} 个 · ${escapeHtml(formatBytes(selectedBytes))}</span>
                        <button class="secondary-button danger-action" type="button" data-maintenance-data-maid-delete-begin ${selectedRows.length === 0 || dataMaid.deleting || dataMaid.confirming ? 'disabled' : ''}>
                            <i class="fa-solid fa-trash"></i>
                            删除所选
                        </button>
                    </div>
                ` : ''}
                ${dataMaid.confirming ? renderDataMaidConfirm(dataMaid) : ''}
                ${renderDataMaidResult(dataMaid)}
            ` : (dataMaid.loading ? '' : '<p class="panel-subtitle">点「开始扫描」生成报告。扫描本身只读，不会改动任何文件。</p>')}
        </section>
    `;
    }

    // ------------------------------------------------------------ 重复的仅开场白会话

    function renderGreetingItem(item, greetings) {
        const isSelected = greetings.selected.includes(item.hash);
        return `
        <div class="maintenance-row ${isSelected ? 'selected' : ''}" data-maintenance-greeting-row="${escapeHtml(item.hash)}">
            <input type="checkbox" data-maintenance-greeting-item="${escapeHtml(item.hash)}" aria-label="选择 ${escapeHtml(item.file)}" ${isSelected ? 'checked' : ''} ${greetings.resolving ? 'disabled' : ''}>
            <span class="row-main">
                <span class="row-title" title="${escapeHtml(item.file)}">${escapeHtml(item.characterName)} · ${escapeHtml(item.file)}</span>
                <span class="row-subtitle">${escapeHtml(formatBytes(item.size))} · 开场白生成于 ${escapeHtml(formatTime(item.sendDate))}${item.swipeCount > 1 ? ` · ${escapeHtml(formatNumber(item.swipeCount))} 条备用开场白` : ''}</span>
                <span class="row-subtitle maintenance-preview-line">“${escapeHtml(item.preview.slice(0, 140))}${item.preview.length > 140 ? '…' : ''}”</span>
                <span class="row-subtitle">保留的会话：${escapeHtml(item.modern.file)}（${escapeHtml(formatNumber(item.modern.messageCount))} 条消息，相隔 ${escapeHtml(formatNumber(Math.round(item.modern.timeDeltaMs / 1000)))} 秒）</span>
                ${item.isCardChat ? `<span class="row-subtitle warning-text"><i class="fa-solid fa-link"></i> 角色卡的「当前会话」正指向这个文件。隔离时会先把它改为 ${escapeHtml(item.modern.file)}。</span>` : ''}
            </span>
        </div>
    `;
    }

    function renderGreetingConfirm(greetings) {
        const chosen = (greetings.items || []).filter(item => greetings.selected.includes(item.hash));
        const repointCount = chosen.filter(item => item.isCardChat).length;
        const totalBytes = chosen.reduce((sum, item) => sum + item.size, 0);
        return `
        <div class="maintenance-confirm" data-maintenance-greeting-confirm-box role="alertdialog" aria-label="确认隔离">
            <p><strong>将把 ${escapeHtml(formatNumber(chosen.length))} 个会话文件（${escapeHtml(formatBytes(totalBytes))}）移到隔离目录，不会删除。</strong></p>
            <p class="panel-subtitle">位置：用户数据目录下 backups/quarantine-时间/chats/角色/。旁边的 manifest.json 记录了每个文件的原路径，需要时把文件移回去即可恢复。</p>
            ${repointCount ? `<p class="warning-text maintenance-wrap"><i class="fa-solid fa-link"></i> 其中 ${escapeHtml(formatNumber(repointCount))} 个是角色卡当前指向的会话：会先把角色卡的「当前会话」改为对应的 Modern 会话，这会改写角色卡文件。</p>` : ''}
            <ul>${chosen.map(item => `<li>${escapeHtml(item.characterName)}：${escapeHtml(item.file)}</li>`).join('')}</ul>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-maintenance-greeting-cancel ${greetings.resolving ? 'disabled' : ''}>取消</button>
                <button class="primary-button" type="button" data-maintenance-greeting-confirm ${greetings.resolving ? 'disabled' : ''}>
                    <i class="fa-solid ${greetings.resolving ? 'fa-circle-notch fa-spin' : 'fa-box-archive'}"></i>
                    确认移到隔离目录
                </button>
            </div>
        </div>
    `;
    }

    function renderGreetingResult(greetings) {
        const result = greetings.result;
        if (!result) {
            return '';
        }
        return `
        <div class="maintenance-result" data-maintenance-greeting-result>
            <p><strong>已移动 ${escapeHtml(formatNumber(result.moved.length))} 个会话文件${result.skipped.length ? `，${escapeHtml(formatNumber(result.skipped.length))} 个跳过` : ''}。</strong></p>
            ${result.quarantine ? `<p class="panel-subtitle">隔离目录：<code>${escapeHtml(result.quarantine)}</code>（相对于用户数据目录）</p>` : ''}
            ${result.moved.length ? `<ul>${result.moved.map(entry => `<li><code>${escapeHtml(entry.from)}</code> → <code>${escapeHtml(entry.to)}</code></li>`).join('')}</ul>` : ''}
            ${result.repointed.length ? `<p class="panel-subtitle">已改写角色卡当前会话的文件：${escapeHtml(result.repointed.join('、'))}</p>` : ''}
            ${result.manifestError ? `<p class="warning-text maintenance-wrap">清单文件 manifest.json 没有写成功：${escapeHtml(result.manifestError)}。文件已经移动，原路径见上面的列表。</p>` : ''}
            ${result.syncNote ? `<p class="warning-text maintenance-wrap">${escapeHtml(result.syncNote)}</p>` : ''}
            ${result.skipped.length ? `
                <p class="warning-text">没有移动的：</p>
                <ul>${result.skipped.map(entry => `<li>${escapeHtml(entry.file || entry.hash)}：${escapeHtml(describeGreetingSkip(entry.reason))}${entry.detail ? `（${escapeHtml(entry.detail)}）` : ''}</li>`).join('')}</ul>
            ` : ''}
        </div>
    `;
    }

    function renderDuplicateGreetingsSection(maintenance) {
        const greetings = maintenance.greetings;
        const items = greetings.items;
        const cardChatItems = (items || []).filter(item => item.isCardChat);
        const plainItems = (items || []).filter(item => !item.isCardChat);

        return `
        <section class="panel section-panel" data-maintenance-section="duplicate-greetings">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">重复的仅开场白会话</h2>
                    <p class="panel-subtitle">早期版本打开角色时，生成引擎会另外建一个只含开场白的会话文件，和界面自己建的「Modern …」会话并存。下面只列出同时满足全部条件的文件，确认后移到隔离目录，不删除。</p>
                </div>
                <button class="secondary-button" type="button" data-maintenance-scan-greetings ${greetings.loading || greetings.resolving ? 'disabled' : ''}>
                    <i class="fa-solid ${greetings.loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'}"></i>
                    ${items ? '重新扫描' : '开始扫描'}
                </button>
            </div>
            <details class="maintenance-rules">
                <summary>列入条件</summary>
                <ul>
                    <li>角色卡仍然存在，文件名是「角色名 - 日期时间.jsonl」格式且角色名与卡片名称一致。</li>
                    <li>文件里只有 1 条消息，不是用户或系统消息，不是新界面写入的，没有图片、附件等内容，内容是卡片的开场白或备用开场白。</li>
                    <li>会话设置里没有用户数据（没有聊天背景、附件、作者注释等）。</li>
                    <li>同目录有时间相差不到 30 分钟的「Modern …」会话，且它以同一条开场白开头或已有至少 2 条消息。</li>
                </ul>
            </details>
            ${greetings.error ? `<p class="danger maintenance-wrap">${escapeHtml(greetings.error)}</p>` : ''}
            ${greetings.loading ? '<p class="panel-subtitle"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在扫描…</p>' : ''}
            ${items ? `
                ${greetings.truncated ? '<p class="maintenance-note warning"><i class="fa-solid fa-triangle-exclamation"></i> 扫描在上限处停止，可能还有更多。</p>' : ''}
                ${items.length === 0 ? '<p class="success maintenance-wrap"><i class="fa-solid fa-circle-check"></i> 没有发现符合条件的重复会话。</p>' : `
                    <div class="maintenance-toolbar">
                        <label class="checkbox-card compact-checkbox">
                            <input type="checkbox" data-maintenance-greeting-all ${greetings.selected.length === items.length ? 'checked' : ''} ${greetings.resolving ? 'disabled' : ''}>
                            <span>全选 ${escapeHtml(formatNumber(items.length))} 个</span>
                        </label>
                        <span class="badge">扫描 ${escapeHtml(formatNumber(greetings.stats?.legacyFiles || 0))} 个「角色名 - 日期时间」命名的会话</span>
                    </div>
                    ${plainItems.length ? `<div class="maintenance-rows" data-maintenance-greeting-list>${plainItems.map(item => renderGreetingItem(item, greetings)).join('')}</div>` : ''}
                    ${cardChatItems.length ? `
                        <h3 class="form-section-title maintenance-subtitle">角色卡当前指向的会话</h3>
                        <div class="maintenance-rows" data-maintenance-greeting-card-list>${cardChatItems.map(item => renderGreetingItem(item, greetings)).join('')}</div>
                    ` : ''}
                    <div class="maintenance-action-bar">
                        <span class="panel-subtitle">已选 ${escapeHtml(formatNumber(greetings.selected.length))} 个</span>
                        <button class="primary-button" type="button" data-maintenance-greeting-begin ${greetings.selected.length === 0 || greetings.resolving || greetings.confirming ? 'disabled' : ''}>
                            <i class="fa-solid fa-box-archive"></i>
                            隔离所选
                        </button>
                    </div>
                `}
                ${greetings.confirming ? renderGreetingConfirm(greetings) : ''}
            ` : (greetings.loading ? '' : '<p class="panel-subtitle">点「开始扫描」查看。扫描只读，不会改动任何文件。</p>')}
            ${renderGreetingResult(greetings)}
        </section>
    `;
    }

    return {
        renderDataMaidSection,
        renderDuplicateGreetingsSection,
    };
}
