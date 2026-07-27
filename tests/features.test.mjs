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
