import assert from 'node:assert/strict';
import {
    applyGoalMode,
    calcAdaptiveTDEE,
    calcBMR,
    calcMovingAverage,
    calcTDEE,
    calculateNutrition,
    suggestCarb,
    suggestFat,
    suggestProtein,
    sumLogs
} from '../lib/nutrition.js';

assert.deepEqual(
    calculateNutrition({ kcal_100: 200, protein_100: 10, carb_100: 20, fat_100: 5 }, 150),
    { kcal: 300, protein: 15, carb: 30, fat: 7.5 }
);
assert.deepEqual(
    calculateNutrition({ ref_amount: 50, kcal_100: 120, protein_100: 8, carb_100: 4, fat_100: 3 }, 75),
    { kcal: 180, protein: 12, carb: 6, fat: 4.5 }
);
assert.deepEqual(
    calculateNutrition({ kcal_100: 200, protein_100: 10, carb_100: 20, fat_100: 5 }, -20),
    { kcal: 0, protein: 0, carb: 0, fat: 0 }
);
assert.deepEqual(
    calculateNutrition({ ref_amount: -100, kcal_100: 200, protein_100: -10, carb_100: 20, fat_100: 5 }, 50),
    { kcal: 100, protein: 0, carb: 10, fat: 2.5 }
);

assert.equal(Math.round(calcBMR('male', 75, 175, 25)), 1724);
assert.equal(Math.round(calcBMR('female', 65, 165, 30)), 1370);
assert.equal(calcTDEE(1700, 1.2, 3, 8000), 2141);
assert.equal(applyGoalMode(2400, 'cut_moderate'), 2040);
assert.equal(applyGoalMode(2400, 'cut_aggressive'), 1800);
assert.equal(applyGoalMode(2400, 'maintain'), 2400);
assert.equal(applyGoalMode(2400, 'bulk'), 2640);
assert.equal(suggestProtein(75, 'cut_moderate'), 150);
assert.equal(suggestProtein(75, 'maintain'), 135);
assert.equal(suggestFat(75), 60);
assert.equal(suggestCarb(2320, 150, 60), 295);
assert.equal(suggestCarb(2563, 212, 85), 238);
assert.equal(calcMovingAverage([
    { weight: 80 }, { weight: 79 }, { weight: 78 }
], 2), 78.5);
assert.deepEqual(sumLogs([
    { kcal: 420, protein: 30, carb: 40, fat: 12 },
    { kcal: 180, protein: 10.5, carb: 20, fat: 5.5 },
    { kcal: -50, protein: 'bozuk', carb: Number.NaN, fat: -1 }
]), { kcal: 600, protein: 40.5, carb: 60, fat: 17.5 });

const weights = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    weight: 80 - (index * 0.05)
}));
const logs = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    kcal: 2200
}));
const adaptive = calcAdaptiveTDEE(weights, logs);
assert.ok(adaptive.adaptiveTDEE > adaptive.avgIntake, 'Kilo kaybında TDEE alınan kaloriden yüksek olmalı');
assert.ok(Math.abs(adaptive.weeklyChange - (-0.35)) < 0.0001);
assert.equal(adaptive.adaptiveTDEE, 2585);

const stableWeights = weights.map(entry => ({ ...entry, weight: 80 }));
const stableAdaptive = calcAdaptiveTDEE(stableWeights, logs);
assert.equal(stableAdaptive.weeklyChange, 0);
assert.equal(stableAdaptive.adaptiveTDEE, 2200);

const gainWeights = weights.map((entry, index) => ({ ...entry, weight: 80 + (index * 0.05) }));
const gainAdaptive = calcAdaptiveTDEE(gainWeights, logs);
assert.ok(gainAdaptive.adaptiveTDEE < gainAdaptive.avgIntake, 'Kilo artışında TDEE alınan kaloriden düşük olmalı');
assert.equal(gainAdaptive.adaptiveTDEE, 1815);

console.log('nutrition tests passed');
