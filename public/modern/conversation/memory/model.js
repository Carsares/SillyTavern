export const MEMORY_KINDS = Object.freeze([
    ['character', '人物'], ['relationship', '关系'], ['world-state', '世界状态'], ['timeline', '时间线'], ['user-fact', '用户事实'],
]);
export function memoryInput(kind, content, locked) {
    if (!MEMORY_KINDS.some(([value]) => value === kind)) throw new Error('请选择有效记忆类型');
    if (typeof content !== 'string' || !content.trim() || content.length > 8000) throw new Error('记忆内容必须包含 1–8000 个字符');
    return { kind, content, locked: Boolean(locked) };
}
