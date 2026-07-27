import assert from 'node:assert/strict';
import {
    convertToBaseAmount,
    getFrequentItemKeys,
    getRememberedPortion,
    recordPortionUsage
} from '../lib/portion.js';
import {
    calculateMacroAdherence,
    calculateWeeklyBudget,
    estimateGoalDate,
    getCalorieStatus,
    getMealTotals,
    getWeightAverages,
    getWeightDataRequirement
} from '../lib/insights.js';
import { APP_SCHEMA_VERSION, runLocalMigrations } from '../lib/schema.js';
import { normalizeProfile, validateCompleteProfile } from '../lib/profile.js';
import { foods } from '../data/foods.js';
import { drinks } from '../data/drinks.js';
import { normalizeSearchText, rankSearchItems } from '../lib/search.js';
import {
    buildAiCatalogCandidates,
    compactAiCandidates,
    detectAiCommandMode
} from '../lib/ai.js';
import { AI_CONTEXT_VERSION, buildCompactAiContext } from '../lib/ai-context.js';
import { addAiUsage, formatTokenCount, normalizeAiUsage } from '../lib/ai-usage.js';
import { DEMO_DATA_VERSION, buildDemoDataset } from '../lib/demo-data.js';

assert.deepEqual(normalizeAiUsage({ input: 120, output: 30, thought: 10 }), {
    requests: 0,
    input: 120,
    output: 30,
    thought: 10,
    total: 160,
    last_model: '',
    last_mode: '',
    last_total: 0
});
assert.deepEqual(
    addAiUsage(
        { requests: 2, input: 300, output: 80, thought: 20, total: 400 },
        { input: 100, output: 25, thought: 5, total: 130 },
        'gemini-3.1-flash-lite',
        'review'
    ),
    {
        requests: 3,
        input: 400,
        output: 105,
        thought: 25,
        total: 530,
        last_model: 'gemini-3.1-flash-lite',
        last_mode: 'review',
        last_total: 130
    }
);
assert.equal(formatTokenCount(965), '965');
assert.equal(formatTokenCount(2400), '2.4K');

const activeMilkAndSmoothieItems = drinks
    .filter(item => /(süt|sut|smoothie|milk)/i.test(item.name))
    .map(item => item.name);
assert.deepEqual(activeMilkAndSmoothieItems, [
    'Pınar Protein Süt Sade (52 g Protein, Laktozsuz)',
    'Pınar Protein Süt Kahveli (52 g Protein, Laktozsuz)',
    'Laktozsuz Süt'
]);

const catalogItems = [...foods, ...drinks];
assert.equal(normalizeSearchText('Süzülmüş İçecek'), 'suzulmus icecek');
assert.equal(rankSearchItems(foods, 'mu', 1)[0]?.name, 'Muz');
assert.equal(rankSearchItems(foods, 'mus', 1)[0]?.name, 'Muz');
assert.deepEqual(rankSearchItems(foods, 'mu').map(item => item.name), ['Muz']);
assert.equal(rankSearchItems(foods, 'ton baligi', 1)[0]?.id, 'food_tuna_water_drained');

const aiCandidates = buildAiCatalogCandidates(
    catalogItems.map(item => ({
        ...item,
        type: drinks.some(drink => drink.id === item.id) ? 'drink' : 'food'
    })),
    'Kahvaltıda iki yumurta, üç dilim tam buğday ekmeği ve 400 ml protein süt içtim.'
);
assert.ok(aiCandidates.some(item => item.name.includes('Yumurta')));
assert.ok(aiCandidates.some(item => item.name.includes('Tam Buğday Ekmeği')));
assert.ok(aiCandidates.some(item => item.name.includes('Protein Süt')));

assert.equal(detectAiCommandMode('Son yedi günümü değerlendir'), 'review');
assert.equal(detectAiCommandMode('Bugün ne yemeliyim?'), 'suggest');
assert.equal(detectAiCommandMode('Öğleye bir dilim cheesecake ekle'), 'add');
assert.deepEqual(compactAiCandidates(aiCandidates.slice(0, 1)), [[
    aiCandidates[0].id,
    aiCandidates[0].name,
    aiCandidates[0].type === 'drink' ? 'd' : 'f'
]]);

const compactContext = buildCompactAiContext({
    profile: {
        weight: 100.24,
        height: 186,
        age: 29,
        targetWeight: 90,
        goalMode: 'cut_moderate'
    },
    targets: {
        restKcal: 2000,
        trainingKcal: 2250,
        protein: 175,
        carb: 125,
        fat: 89
    },
    days: [{
        offset: 0,
        kcal: 1900,
        targetKcal: 2000,
        protein: 174.95,
        carb: 130.14,
        fat: 80.25,
        fiber: 25.55,
        sugar: 31.14,
        salt: 4.05,
        trained: false,
        count: 4
    }],
    weight: {
        current: 100.2,
        avg7: 100.4,
        avg14: 100.8,
        avg30: 101.5,
        weeklyChange: -0.6
    }
});
assert.deepEqual(compactContext, [
    AI_CONTEXT_VERSION,
    [100.2, 186, 29, 90, 'cm'],
    [2000, 2250, 175, 125, 89],
    [[0, 1900, 2000, 175, 130.1, 80.3, 25.6, 31.1, 4.1, 0, 4]],
    [100.2, 100.4, 100.8, 101.5, -0.6]
]);

const demoDataset = buildDemoDataset({
    today: '2026-07-27',
    profileWeight: 100,
    batchId: 'demo_test'
});
assert.equal(demoDataset.version, DEMO_DATA_VERSION);
assert.equal(demoDataset.days.length, 15);
assert.equal(demoDataset.days[0].date, '2026-07-13');
assert.equal(demoDataset.days.at(-1).date, '2026-07-27');
assert.equal(demoDataset.weights.length, 15);
assert.ok(demoDataset.logs.length >= 150);
assert.ok(demoDataset.weights[0].weight > demoDataset.weights.at(-1).weight);
assert.ok(demoDataset.logs.every(entry =>
    entry.amount > 0
    && ['breakfast', 'lunch', 'dinner', 'snack'].includes(entry.mealType)
));
assert.ok(Object.values(demoDataset.dailyMeta).every(meta =>
    meta.is_demo === true && meta.demo_batch_id === 'demo_test'
));

assert.ok(foods.length >= 180, 'Günlük yiyecek kataloğu yetersiz.');
assert.ok(drinks.length >= 40, 'Günlük içecek kataloğu yetersiz.');
assert.equal(new Set(catalogItems.map(item => item.id)).size, catalogItems.length);
for (const item of catalogItems) {
    assert.ok(item.category);
    assert.ok(item.nutrition_source);
    assert.ok(['verified', 'estimated', 'personal'].includes(item.nutrition_confidence));
    for (const field of ['fiber_100', 'sugar_100', 'sodium_100']) {
        assert.ok(Number.isFinite(item[field]) && item[field] >= 0, `${item.id}: ${field}`);
    }
}
assert.equal(
    catalogItems.filter(item => /(smoothie|ton balıklı salata|menemen|sandviç)/i.test(item.name)).length,
    0,
    'Karışık yemekler temel katalog yerine tarif olarak oluşturulmalı.'
);

const food = { id: 'food_1', portion_grams: 80, slice_grams: 25 };
assert.equal(convertToBaseAmount(2, 'portion', food, 'food'), 160);
assert.equal(convertToBaseAmount(3, 'slice', food, 'food'), 75);
assert.equal(convertToBaseAmount(1, 'glass', {}, 'drink'), 200);
assert.equal(convertToBaseAmount(2, 'piece', { name: 'Yumurta (Haşlanmış)' }, 'food'), 110);
assert.equal(convertToBaseAmount(1, 'piece', { name: 'Sandviç (1 Adet = 280g)' }, 'food'), 280);
assert.equal(convertToBaseAmount(2, 'slice', { name: 'Tam Buğday Ekmeği' }, 'food'), 50);

let memory = {};
memory = recordPortionUsage(memory, 'food_1', 'food', 2, 'slice', 100);
memory = recordPortionUsage(memory, 'food_1', 'food', 1, 'portion', 200);
memory = recordPortionUsage(memory, 'food_2', 'food', 100, 'g', 300);
assert.deepEqual(getRememberedPortion(memory, 'food_1', 'food'), {
    amount: 1,
    unit: 'portion',
    count: 2,
    lastUsedAt: 200
});
assert.deepEqual(getFrequentItemKeys(memory, 'food'), ['food_1', 'food_2']);

assert.deepEqual(getMealTotals([
    { kcal: 300, protein: 20, carb: 30, fat: 10 },
    { kcal: 200, protein: 10, carb: 15, fat: 5 }
]), { kcal: 500, protein: 30, carb: 45, fat: 15 });

const weights = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    weight: 80 - (index * 0.1)
}));
assert.deepEqual(getWeightAverages(weights), { 7: 79, 14: 79.4, 30: 79.4 });
assert.deepEqual(getWeightDataRequirement(weights.slice(0, 4)), {
    count: 4, minimum: 7, remaining: 3, ready: false
});
assert.ok(estimateGoalDate(weights, 75)?.days > 0);

const dates = ['2026-07-01', '2026-07-02'];
const logs = [
    { date: dates[0], kcal: 2100, protein: 140, carb: 230, fat: 70 },
    { date: dates[1], kcal: 2300, protein: 160, carb: 270, fat: 90 }
];
assert.deepEqual(calculateWeeklyBudget(logs, 2200, dates), {
    target: 4400, consumed: 4400, remaining: 0, percentage: 100
});
assert.equal(calculateMacroAdherence(logs, { protein: 150, carb: 250, fat: 80 }, dates).protein.percentage, 100);
assert.equal(
    calculateMacroAdherence(
        logs,
        date => date === dates[0]
            ? { protein: 140, carb: 230, fat: 70 }
            : { protein: 160, carb: 270, fat: 90 },
        dates
    ).protein.percentage,
    100
);
assert.equal(getCalorieStatus(2200, 2200), 'on-target');

const values = new Map([['recentItems', '[1]']]);
const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
};
assert.deepEqual(runLocalMigrations(storage), { from: 1, to: APP_SCHEMA_VERSION, migrated: true });
assert.equal(values.get('recentItemsV2'), '[1]');
assert.match(values.get('macroPreferences'), /protein_focused/);

const normalizedProfile = normalizeProfile({
    gender: 'male',
    age: 30,
    height: 180,
    weight: 82,
    activity: 1.55,
    trainingDays: 3,
    steps: 8000,
    goalMode: 'cut_moderate',
    targetWeight: 75
});
assert.equal(normalizedProfile.targetWeight, 75);
assert.equal(validateCompleteProfile(normalizedProfile), '');

console.log('feature tests passed');
