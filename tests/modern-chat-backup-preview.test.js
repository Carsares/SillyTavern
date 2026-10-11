import { describe, expect, test } from '@jest/globals';

import { formatChatBackupPreview } from '../public/modern/actions/chat-backups.js';

const formatDate = value => `D(${value})`;
const jsonl = (...items) => items.map(item => JSON.stringify(item)).join('\n');

describe('formatChatBackupPreview', () => {
    test('shows the original text of a translated message and says it has a translation', () => {
        const text = formatChatBackupPreview(jsonl(
            { chat_metadata: {} },
            { name: 'Rei', send_date: 1, mes: '你好，我是绫波丽。', extra: { display_text: 'Hello, I am Rei Ayanami.' } },
            { name: 'User', send_date: 2, mes: 'hi' },
        ), formatDate);

        expect(text).toBe('Rei · D(1) · 有译文（这里显示原文）\n你好，我是绫波丽。\n\nUser · D(2)\nhi');
        expect(text).not.toContain('Hello, I am Rei Ayanami.');
    });

    test('an empty translation is not reported', () => {
        expect(formatChatBackupPreview(jsonl({ name: 'Rei', send_date: 1, mes: 'text', extra: { display_text: '  ' } }), formatDate))
            .toBe('Rei · D(1)\ntext');
    });

    test('keeps the last 40 messages, skips broken lines and reports an empty backup', () => {
        const items = Array.from({ length: 45 }, (_, index) => ({ name: 'N', send_date: index, mes: `m${index}` }));
        const text = formatChatBackupPreview(`${jsonl(...items)}\n{broken`, formatDate);

        expect(text.split('\n\n')).toHaveLength(40);
        expect(text.startsWith('N · D(5)\nm5')).toBe(true);
        expect(formatChatBackupPreview('{broken\n', formatDate)).toBe('这个备份没有可预览的消息。');
    });
});
