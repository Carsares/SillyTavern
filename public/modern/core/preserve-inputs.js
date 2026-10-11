// 整页重绘（shell/renderer.js 用 innerHTML 换掉 #content）前后保住设置表单里还没提交的输入和焦点。
// 后台轮询、测试连接等都会触发整页重绘，没有这一步，正在输入的内容会被重置成已保存的值。
//
// 只处理 [data-preserve-inputs] 容器里的控件；其余页面（例如聊天输入框）自己管理草稿，不在这里碰。
// 一个控件会被保住：它是当前焦点，或它的值和渲染时的初始值（defaultValue / defaultChecked / defaultSelected）不同。
// 重绘后按同一个键找回控件。新控件的初始值和旧控件的初始值相同，说明已保存的值没变，才把输入写回；
// 已保存的值变了（保存成功、应用档案、恢复快照），就以新值为准，只恢复焦点。

const CONTROL_SELECTOR = '[data-preserve-inputs] input, [data-preserve-inputs] textarea, [data-preserve-inputs] select';
const SKIPPED_INPUT_TYPES = new Set(['file', 'button', 'submit', 'reset', 'image', 'hidden']);

/**
 * @typedef {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} Control
 * @typedef {{ key: string, focused: boolean, value: unknown, initial: unknown, selection: [number, number] | null }} PreservedInput
 */

/**
 * @param {Element} element 控件
 * @returns {element is Control} 是否为要处理的控件
 */
function isControl(element) {
    if (element instanceof HTMLInputElement) {
        return !SKIPPED_INPUT_TYPES.has(element.type);
    }
    return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

/**
 * 控件的识别键：标签、name 和全部 data-* 属性。同键的控件按出现顺序编号。
 * @param {Control} control 控件
 * @returns {string} 键（不含序号）
 */
function getBaseKey(control) {
    const data = Object.entries(control.dataset).sort(([a], [b]) => a.localeCompare(b));
    return `${control.tagName}|${control.getAttribute('type') || ''}|${control.getAttribute('name') || ''}|${JSON.stringify(data)}`;
}

/**
 * @param {Control} control 控件
 * @returns {{ value: unknown, initial: unknown }} 当前值和渲染时的初始值
 */
function readControl(control) {
    if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
        return { value: control.checked, initial: control.defaultChecked };
    }
    if (control instanceof HTMLSelectElement) {
        const options = Array.from(control.options);
        let initial = options.filter(option => option.defaultSelected).map(option => option.value);
        if (!initial.length && !control.multiple && options.length) {
            initial = [options[0].value];
        }
        return { value: Array.from(control.selectedOptions).map(option => option.value), initial };
    }
    return { value: control.value, initial: control.defaultValue };
}

/**
 * @param {Control} control 控件
 * @param {unknown} value readControl 读出的值
 */
function writeControl(control, value) {
    if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
        control.checked = Boolean(value);
        return;
    }
    if (control instanceof HTMLSelectElement) {
        const selected = new Set(/** @type {string[]} */ (value));
        for (const option of control.options) {
            option.selected = selected.has(option.value);
        }
        return;
    }
    control.value = String(value ?? '');
}

/**
 * @param {Control} control 控件
 * @returns {boolean} 是否支持读写选区（number、select 等不支持）
 */
function supportsSelection(control) {
    if (control instanceof HTMLTextAreaElement) {
        return true;
    }
    return control instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password'].includes(control.type);
}

/**
 * @param {ParentNode} root 容器
 * @returns {Map<string, Control>} 键（含序号）到控件
 */
function collectControls(root) {
    const controls = new Map();
    const counts = new Map();
    for (const element of root.querySelectorAll(CONTROL_SELECTOR)) {
        if (!isControl(element)) {
            continue;
        }
        const base = getBaseKey(element);
        const index = counts.get(base) || 0;
        counts.set(base, index + 1);
        controls.set(`${base}#${index}`, element);
    }
    return controls;
}

/**
 * 重绘前调用：记下需要保住的控件。
 * @param {Element} root 将被重绘的容器（#content）
 * @returns {PreservedInput[]} 记录
 */
export function capturePreservedInputs(root) {
    const active = root.ownerDocument.activeElement;
    /** @type {PreservedInput[]} */
    const records = [];
    for (const [key, control] of collectControls(root)) {
        const focused = control === active;
        // 密钥框只在正在输入时保住：失焦就已经保存（或放弃），保存后的重绘应当清空它
        if (!focused && control instanceof HTMLInputElement && control.type === 'password') {
            continue;
        }
        const { value, initial } = readControl(control);
        const dirty = JSON.stringify(value) !== JSON.stringify(initial);
        if (!focused && !dirty) {
            continue;
        }
        const textControl = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (control);
        records.push({
            key,
            focused,
            value: dirty ? value : undefined,
            initial,
            selection: focused && supportsSelection(control)
                ? [textControl.selectionStart ?? 0, textControl.selectionEnd ?? 0]
                : null,
        });
    }
    return records;
}

/**
 * 重绘后调用：把还没提交的输入和焦点放回新控件。
 * @param {Element} root 已重绘的容器
 * @param {PreservedInput[]} records capturePreservedInputs 的结果
 */
export function restorePreservedInputs(root, records) {
    if (!records.length) {
        return;
    }
    const controls = collectControls(root);
    for (const record of records) {
        const control = controls.get(record.key);
        if (!control) {
            continue;
        }
        const savedValueUnchanged = JSON.stringify(readControl(control).initial) === JSON.stringify(record.initial);
        if (record.value !== undefined && savedValueUnchanged) {
            writeControl(control, record.value);
        }
        if (record.focused && !control.disabled) {
            control.focus({ preventScroll: true });
            if (record.selection && supportsSelection(control)) {
                try {
                    /** @type {HTMLInputElement | HTMLTextAreaElement} */ (control).setSelectionRange(record.selection[0], record.selection[1]);
                } catch {
                    // 个别输入类型不支持选区，焦点已恢复即可
                }
            }
        }
    }
}
