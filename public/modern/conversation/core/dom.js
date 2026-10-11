export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'class') node.className = value;
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
}
export const button = (label, action, disabled = false) => el('button', { type: 'button', onclick: action, disabled }, label);
export const field = (label, control) => el('label', {}, el('span', {}, label), control);
export const input = (value = '', attrs = {}) => el('input', { value, ...attrs });
export const json = value => el('pre', { class: 'json' }, JSON.stringify(value, null, 2));
export const empty = text => el('p', { class: 'empty' }, text);
export function select(options, value, attrs = {}) {
    const node = el('select', attrs, options.map(([id, name]) => el('option', { value: id }, name)));
    node.value = value ?? '';
    return node;
}
export function parseObject(text) {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('请输入 JSON 对象');
    return value;
}
export function download(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
