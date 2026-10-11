import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { followModernTheme, MODERN_THEME_KEY } from '../../../../public/modern/conversation/core/theme.js';

const css = file => readFile(new URL(`../../../../public/modern/${file}`, import.meta.url), 'utf8');
function tokens(source, selector) {
    const start = source.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    const block = source.slice(start, source.indexOf('}', start));
    return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

test('Agent client theme tokens mirror the Modern shell in light and dark themes', async () => {
    const [modern, agent] = await Promise.all([css('styles/base.css'), css('conversation/style.css')]);
    for (const selector of [':root', '[data-theme="dark"]']) {
        const expected = tokens(modern, selector), actual = tokens(agent, selector);
        for (const name of Object.keys(expected).filter(name => !/^--(sidebar|inspector)-width$/.test(name))) {
            assert.equal(actual[name], expected[name], `${selector} ${name}`);
        }
        assert.deepEqual(Object.keys(actual).filter(name => !(name in expected)), [], `${selector} has no extra tokens`);
    }
});

test('Agent client follows the Modern theme setting and marks embedded use', () => {
    const values = new Map([[MODERN_THEME_KEY, 'dark']]);
    const listeners = [];
    const target = { localStorage: { getItem: key => values.get(key) ?? null }, addEventListener: (type, listener) => listeners.push([type, listener]) };
    target.self = target; target.top = {};
    const root = { dataset: {} };
    followModernTheme(root, target);
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(root.dataset.embedded, '');
    values.set(MODERN_THEME_KEY, 'light');
    listeners.find(([type]) => type === 'storage')[1]({ key: MODERN_THEME_KEY });
    assert.equal(root.dataset.theme, 'light');
    const standalone = { ...target, addEventListener() {} };
    standalone.self = standalone; standalone.top = standalone;
    const other = { dataset: {} };
    followModernTheme(other, standalone);
    assert.equal(other.dataset.theme, 'light');
    assert.equal('embedded' in other.dataset, false);
});
