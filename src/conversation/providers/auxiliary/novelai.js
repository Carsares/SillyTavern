// New NovelAI text-to-image codec. V4/V4.5 wire fixtures only; no live verification.
import { fail } from '../core/index.js';

export function encodeNovelImage(model, options = {}) {
    const { prompt, negativePrompt = '', width = 1024, height = 1024, count = 1,
        seed = 0, steps = 28, scale = 5, sampler = 'k_euler', noiseSchedule = 'native', characters = [], useCoordinates = false } = options;
    const v4 = /^nai-diffusion-4(?:-5)?(?:-|$)/.test(model);
    if (typeof prompt !== 'string' || typeof negativePrompt !== 'string' || !Number.isFinite(scale) || scale <= 0
        || typeof sampler !== 'string' || !sampler || typeof noiseSchedule !== 'string' || !noiseSchedule
        || !Array.isArray(characters) || characters.length > 6 || typeof useCoordinates !== 'boolean') throw fail('invalid-image-options', 'Invalid NovelAI image options');
    if (![width, height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096 && value % 64 === 0)
        || !Number.isSafeInteger(count) || count < 1 || count > 4 || !Number.isSafeInteger(seed) || seed < 0
        || !Number.isSafeInteger(steps) || steps < 1 || steps > 150) throw fail('invalid-image-options', 'Invalid NovelAI dimensions, count, seed or steps');
    if (!v4 && (characters.length || useCoordinates)) throw fail('unsupported-parameters', 'Character prompts require a NovelAI V4/V4.5 model');
    const cast = characters.map(character => {
        const center = character.center ?? { x: 0.5, y: 0.5 };
        if (typeof character.prompt !== 'string' || typeof (character.negativePrompt ?? '') !== 'string'
            || ![center.x, center.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw fail('invalid-image-options', 'Character prompt or coordinates are invalid');
        return { prompt: character.prompt, uc: character.negativePrompt ?? '', center: { x: center.x, y: center.y } };
    });
    const parameters = { width, height, n_samples: count, seed, steps, scale, sampler, negative_prompt: negativePrompt };
    if (options.noiseSchedule !== undefined) parameters.noise_schedule = noiseSchedule;
    if (v4) Object.assign(parameters, {
        params_version: 3, noise_schedule: noiseSchedule, use_coords: useCoordinates, characterPrompts: cast,
        v4_prompt: { caption: { base_caption: prompt, char_captions: cast.map(character => ({ char_caption: character.prompt, centers: [{ ...character.center }] })) }, use_coords: useCoordinates, use_order: true },
        v4_negative_prompt: { caption: { base_caption: negativePrompt, char_captions: cast.map(character => ({ char_caption: character.uc, centers: [{ ...character.center }] })) } },
    });
    return { input: prompt, model, action: 'generate', parameters };
}
