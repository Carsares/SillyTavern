const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unknown = () => ({ costUsd: null, costSource: null, costEstimated: null });

/** Only documented USD fields or an explicitly identified SDK estimate are money.
 * OpenRouter cost is account charge; upstream_inference_cost is NOT additive.
 */
export function normalizeCost(value, { provider, sdkUsage, sdkEstimated = false } = {}) {
    if (value && Object.hasOwn(value, 'costUsd')) {
        if (!amount(value.costUsd)) return unknown();
        const estimated = value.costEstimated === true || value.costSource === 'sdk-estimated';
        return { costUsd: value.costUsd, costSource: estimated ? 'sdk-estimated' : 'provider', costEstimated: estimated };
    }
    if (provider === 'openrouter' && value && Object.hasOwn(value, 'cost')) {
        return amount(value.cost) ? { costUsd: value.cost, costSource: 'provider', costEstimated: false } : unknown();
    }
    if ((sdkEstimated || sdkUsage?.costEstimated === true || sdkUsage?.costSource === 'sdk-estimated') && amount(sdkUsage?.cost?.total)) {
        return { costUsd: sdkUsage.cost.total, costSource: 'sdk-estimated', costEstimated: true };
    }
    return unknown();
}

export function aggregateCost(requests) {
    if (!requests.length || requests.some(request => !amount(request.costUsd))) return unknown();
    const costUsd = requests.reduce((total, request) => total + request.costUsd, 0);
    if (!amount(costUsd)) return unknown();
    const sources = new Set(requests.map(request => request.costSource));
    return { costUsd, costSource: sources.size === 1 ? requests[0].costSource : 'mixed',
        costEstimated: requests.some(request => request.costEstimated === true) };
}
