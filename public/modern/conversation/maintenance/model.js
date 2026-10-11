import { BACKUP_MAX_BYTES, SCHEMA_VERSION } from '../../../shared/conversation/schemas/index.js';
export { BACKUP_MAX_BYTES };
export const BACKUP_COPY_GUIDANCE = '超出 JSON 备份限制时，请正常停止服务器，完整复制 conversation-v1 目录（含数据库、SQLite 伴随文件与附件）；恢复到相同 schema 版本的空目录后再启动。不要单独复制运行中的数据库。';
export function restoreBody(data, limit = BACKUP_MAX_BYTES) {
    const body = { data, schemaVersion: SCHEMA_VERSION };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > limit) throw new Error(`恢复请求连同包体超过 256 MiB。${BACKUP_COPY_GUIDANCE}`);
    return { data };
}

export function cleanupRequest(days) {
    const value = Number(days);
    if (String(days).trim() === '' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value * 86400000)) throw new Error('轨迹保留天数须为非负数，换算后须为整数毫秒');
    return { traceRetentionMs: value * 86400000 };
}
export function effectiveExport(data) {
    if (data?.format !== 'conversation-v1-export' || data.schemaVersion !== 1 || !Array.isArray(data.conversations)) throw new Error('服务器未返回有效历史导出格式，未下载');
    return data;
}
