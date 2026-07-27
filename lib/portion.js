export const PORTION_MEMORY_KEY = 'portionUsageV2';

const FOOD_UNITS = Object.freeze([
    { value: 'g', label: 'Gram', shortLabel: 'g', factor: 1 },
    { value: 'portion', label: 'Porsiyon', shortLabel: 'porsiyon', fallbackFactor: 100, itemField: 'portion_grams' },
    { value: 'piece', label: 'Adet', shortLabel: 'adet', fallbackFactor: 100, itemField: 'piece_grams' },
    { value: 'slice', label: 'Dilim', shortLabel: 'dilim', fallbackFactor: 30, itemField: 'slice_grams' },
    { value: 'tablespoon', label: 'Yemek kaşığı', shortLabel: 'yk', fallbackFactor: 15, itemField: 'tablespoon_grams' }
]);

const DRINK_UNITS = Object.freeze([
    { value: 'ml', label: 'Mililitre', shortLabel: 'ml', factor: 1 },
    { value: 'glass', label: 'Bardak', shortLabel: 'bardak', fallbackFactor: 200, itemField: 'glass_ml' },
    { value: 'tea_glass', label: 'Çay bardağı', shortLabel: 'çay bardağı', fallbackFactor: 100, itemField: 'tea_glass_ml' },
    { value: 'cup', label: 'Kupa', shortLabel: 'kupa', fallbackFactor: 250, itemField: 'cup_ml' },
    { value: 'tablespoon', label: 'Yemek kaşığı', shortLabel: 'yk', fallbackFactor: 15, itemField: 'tablespoon_ml' }
]);

function inferNamedFactor(item, unitValue, fallbackFactor) {
    const name = String(item?.name || '');
    const unitPatterns = {
        portion: /1\s*(?:porsiyon|ölçek)\s*=\s*(\d+(?:[.,]\d+)?)\s*g/i,
        piece: /1\s*adet\s*=\s*(\d+(?:[.,]\d+)?)\s*g/i,
        slice: /1\s*dilim\s*=\s*(\d+(?:[.,]\d+)?)\s*g/i
    };
    const pattern = unitPatterns[unitValue];
    const match = pattern ? name.match(pattern) : null;
    if (match) return Number(match[1].replace(',', '.'));

    const normalized = name.toLocaleLowerCase('tr-TR');
    if (unitValue === 'piece') {
        if (normalized.includes('yumurta')) return 55;
        if (normalized.includes('muz')) return 120;
        if (normalized.includes('elma') || normalized.includes('portakal')) return 180;
        if (normalized.includes('simit')) return 100;
    }
    if (unitValue === 'slice') {
        if (normalized.includes('ekmek') || normalized.includes('ekmeğ')) return 25;
        if (normalized.includes('peynir')) return 30;
    }
    return fallbackFactor;
}

export function getPortionKey(itemId, itemType) {
    return `${itemType === 'drink' ? 'drink' : 'food'}:${String(itemId || '')}`;
}

export function getUnitOptions(item, itemType) {
    const source = itemType === 'drink' ? DRINK_UNITS : FOOD_UNITS;
    return source.map(unit => ({
        ...unit,
        factor: unit.factor ?? (
            Number(item?.[unit.itemField])
            || inferNamedFactor(item, unit.value, unit.fallbackFactor)
        )
    }));
}

export function convertToBaseAmount(displayAmount, unitValue, item, itemType) {
    const amount = Number(displayAmount);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const unit = getUnitOptions(item, itemType).find(option => option.value === unitValue)
        || getUnitOptions(item, itemType)[0];
    return Math.round(amount * unit.factor * 10) / 10;
}

export function normalizePortionMemory(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const normalized = {};
    Object.entries(raw).slice(0, 1000).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        const amount = Number(value.amount);
        const count = Number(value.count);
        const lastUsedAt = Number(value.lastUsedAt);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return;
        normalized[key] = {
            amount,
            unit: String(value.unit || ''),
            count: Number.isFinite(count) && count > 0 ? Math.round(count) : 1,
            lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : 0
        };
    });
    return normalized;
}

export function recordPortionUsage(memory, itemId, itemType, amount, unit, usedAt = Date.now()) {
    const normalized = normalizePortionMemory(memory);
    const key = getPortionKey(itemId, itemType);
    const previous = normalized[key] || { count: 0 };
    normalized[key] = {
        amount: Number(amount),
        unit: String(unit || (itemType === 'drink' ? 'ml' : 'g')),
        count: previous.count + 1,
        lastUsedAt: Number(usedAt)
    };
    return normalized;
}

export function getRememberedPortion(memory, itemId, itemType) {
    return normalizePortionMemory(memory)[getPortionKey(itemId, itemType)] || null;
}

export function getFrequentItemKeys(memory, itemType, limit = 6) {
    const prefix = `${itemType === 'drink' ? 'drink' : 'food'}:`;
    return Object.entries(normalizePortionMemory(memory))
        .filter(([key]) => key.startsWith(prefix))
        .sort(([, a], [, b]) => {
            if (a.count !== b.count) return b.count - a.count;
            return b.lastUsedAt - a.lastUsedAt;
        })
        .slice(0, limit)
        .map(([key]) => key.slice(prefix.length));
}
