import { normalizeSearchText, rankSearchItems } from './search.js';

const AI_STOP_WORDS = new Set([
    'a', 'acaba', 'ama', 'ara', 'az', 'bardak', 'ben', 'bir', 'biraz', 'bugun',
    'bunu', 'da', 'de', 'dilim', 'diye', 'ekle', 'ekledim', 'g', 'gram', 'icdim',
    'icin', 'ile', 'kadar', 'kasik', 'kase', 'kupa', 'mi', 'ml', 'ne', 'ogle',
    'olarak', 'porsiyon', 'sabah', 'sonra', 'su', 'tane', 've', 'yedim', 'yemek'
]);

const ALLOWED_INTENTS = new Set(['log_meal', 'advice', 'clarify']);
const ALLOWED_MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const ALLOWED_UNITS = new Set([
    'g',
    'ml',
    'piece',
    'slice',
    'portion',
    'glass',
    'tea_glass',
    'cup',
    'tablespoon'
]);

export function detectAiCommandMode(message) {
    const normalized = normalizeSearchText(message);
    if (/(degerlendir|degerlendirme|son 7 gun|son yedi gun|haftami yorumla)/.test(normalized)) {
        return 'review';
    }
    if (/(ogun oner|yemek oner|ne yiyebilirim|ne yemeliyim|sonraki ogun)/.test(normalized)) {
        return 'suggest';
    }
    return 'add';
}

export function compactAiCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : []).map(item => [
        String(item?.id || ''),
        String(item?.name || ''),
        item?.type === 'drink' ? 'd' : 'f'
    ]).filter(item => item[0] && item[1]);
}

function getSearchTerms(message) {
    const words = normalizeSearchText(message)
        .split(/\s+/)
        .filter(word =>
            word.length >= 2
            && !AI_STOP_WORDS.has(word)
            && !/^\d+(?:[.,]\d+)?$/.test(word)
        );
    const terms = [...words];
    for (let index = 0; index < words.length - 1; index += 1) {
        terms.push(`${words[index]} ${words[index + 1]}`);
    }
    return [...new Set(terms)].sort((left, right) => right.length - left.length);
}

function getDefaultUnit(item) {
    return item?.type === 'drink' ? 'ml' : 'g';
}

export function buildAiCatalogCandidates(items, message, maxItems = 40) {
    const source = Array.isArray(items)
        ? items.filter(item => item?.id && item?.name)
        : [];
    const terms = getSearchTerms(message);
    const matches = new Map();

    terms.forEach((term, termIndex) => {
        rankSearchItems(source, term, 5).forEach((item, resultIndex) => {
            const score = (termIndex * 3) + resultIndex;
            const previous = matches.get(item.id);
            if (!previous || score < previous.score) {
                matches.set(item.id, { item, score });
            }
        });
    });

    return [...matches.values()]
        .sort((left, right) =>
            left.score - right.score
            || left.item.name.localeCompare(right.item.name, 'tr')
        )
        .slice(0, maxItems)
        .map(({ item }) => ({
            id: String(item.id),
            name: String(item.name),
            type: item.type === 'drink' ? 'drink' : 'food',
            default_unit: getDefaultUnit(item)
        }));
}

export function normalizeAiChatResult(raw, allowedCandidateIds = []) {
    const candidateIds = new Set(allowedCandidateIds.map(String));
    const source = raw && typeof raw === 'object' ? raw : {};
    const intent = ALLOWED_INTENTS.has(source.intent) ? source.intent : 'clarify';
    const mealType = ALLOWED_MEALS.has(source.meal_type) ? source.meal_type : null;
    const items = Array.isArray(source.items) ? source.items.slice(0, 20) : [];

    return {
        intent,
        reply: String(source.reply || '').trim().slice(0, 2400),
        meal_type: mealType,
        items: items.map(item => {
            const matchedId = item?.matched_id == null ? null : String(item.matched_id);
            const amount = Number(item?.amount);
            const confidence = Number(item?.confidence);
            return {
                matched_id: matchedId && candidateIds.has(matchedId) ? matchedId : null,
                query_name: String(item?.query_name || '').trim().slice(0, 120),
                amount: Number.isFinite(amount) && amount > 0 && amount <= 100000 ? amount : null,
                unit: ALLOWED_UNITS.has(item?.unit) ? item.unit : null,
                confidence: Number.isFinite(confidence)
                    ? Math.min(1, Math.max(0, confidence))
                    : 0,
                note: String(item?.note || '').trim().slice(0, 240)
            };
        })
    };
}

export function normalizeAiReviewResult(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const cleanList = value => Array.isArray(value)
        ? value.map(entry => String(entry || '').trim()).filter(Boolean).slice(0, 5)
        : [];

    return {
        summary: String(source.summary || '').trim().slice(0, 1200),
        positives: cleanList(source.positives),
        attention: cleanList(source.attention),
        suggestions: cleanList(source.suggestions),
        disclaimer: String(source.disclaimer || '').trim().slice(0, 360)
    };
}
