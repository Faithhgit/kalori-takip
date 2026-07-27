const EMPTY_AI_USAGE = Object.freeze({
    requests: 0,
    input: 0,
    output: 0,
    thought: 0,
    total: 0,
    last_model: '',
    last_mode: '',
    last_total: 0
});

function safeCount(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

export function normalizeAiUsage(value = {}) {
    const usage = value && typeof value === 'object' ? value : {};
    const input = safeCount(usage.input);
    const output = safeCount(usage.output);
    const thought = safeCount(usage.thought);
    return {
        ...EMPTY_AI_USAGE,
        requests: safeCount(usage.requests),
        input,
        output,
        thought,
        total: safeCount(usage.total) || input + output + thought,
        last_model: String(usage.last_model || ''),
        last_mode: String(usage.last_mode || ''),
        last_total: safeCount(usage.last_total)
    };
}

export function addAiUsage(current, requestUsage, model = '', mode = '') {
    const existing = normalizeAiUsage(current);
    const request = normalizeAiUsage(requestUsage);
    const requestTotal = request.total || request.input + request.output + request.thought;
    return {
        requests: existing.requests + 1,
        input: existing.input + request.input,
        output: existing.output + request.output,
        thought: existing.thought + request.thought,
        total: existing.total + requestTotal,
        last_model: String(model || existing.last_model),
        last_mode: String(mode || existing.last_mode),
        last_total: requestTotal
    };
}

export function formatTokenCount(value) {
    const count = safeCount(value);
    if (count < 1000) return String(count);
    if (count < 1_000_000) {
        return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace('.0', '')}K`;
    }
    return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0).replace('.0', '')}M`;
}
