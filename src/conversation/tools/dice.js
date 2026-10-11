import { invariant } from '../../../public/shared/conversation/schemas/index.js';

/** Grammar: signed integer/dice terms joined by + or -. No evaluation of source code. */
export function rollDice(expr, random = Math.random) {
    invariant(typeof expr === 'string' && expr.length <= 200, 'invalid-dice', 'Dice expression is required (max 200 characters)');
    const source = expr.trim().replace(/\s*([+-])\s*/gu, '$1');
    invariant(/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/iu.test(source), 'invalid-dice', 'Expected dice and integer terms joined by + or -');
    const parsed = [...source.matchAll(/([+-]?)(\d*d\d+|\d+)/giu)].map(([, sign, term]) => {
        const signValue = sign === '-' ? -1 : 1;
        if (!term.toLowerCase().includes('d')) {
            const constant = Number(term);
            invariant(Number.isSafeInteger(constant) && constant <= 1000000, 'invalid-dice', 'Constant exceeds limit');
            return { sign: signValue, constant };
        }
        const [countRaw, sidesRaw] = term.toLowerCase().split('d');
        const count = Number(countRaw || 1), sides = Number(sidesRaw);
        invariant(Number.isSafeInteger(count) && count >= 1 && count <= 100 && Number.isSafeInteger(sides) && sides >= 2 && sides <= 1000000,
            'invalid-dice', 'Dice count or sides exceeds limit');
        return { sign: signValue, count, sides };
    });
    invariant(parsed.length <= 32 && parsed.reduce((n, p) => n + (p.count ?? 0), 0) <= 100, 'invalid-dice', 'Too many dice or terms');
    const terms = parsed.map(term => {
        if (term.constant !== undefined) return term;
        return { ...term, rolls: Array.from({ length: term.count }, () => {
            const value = random();
            invariant(Number.isFinite(value) && value >= 0 && value < 1, 'invalid-random', 'Random source is outside [0,1)');
            return 1 + Math.floor(value * term.sides);
        }) };
    });
    return { expr, terms, total: terms.reduce((n, term) => n + term.sign * (term.constant ?? term.rolls.reduce((a, b) => a + b, 0)), 0) };
}
