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
import {
    calculateDayTypeEnergyTargets,
    calculateGoalTarget,
    calculateMacroTargets,
    calculateRecipeNutrition,
    createRecipeCatalogItem,
    getMacroGuidance,
    inferNutritionConfidence,
    normalizeMacroPreferences,
    resolveDayEnergyTarget,
    sodiumMgToSaltGrams,
    sumIngredientAmounts
} from '../lib/planning.js';

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
assert.equal(calculateGoalTarget(2500, 'cut_moderate'), 2325);
assert.equal(calculateGoalTarget(2500, 'maintain'), 2500);
assert.deepEqual(
    calculateMacroTargets(2320, { strategy: 'protein_focused' }),
    { protein: 203, carb: 203, fat: 77 }
);
assert.deepEqual(
    calculateDayTypeEnergyTargets(2105, 3),
    { trainingDayKcal: 2250, restDayKcal: 2000 }
);
assert.deepEqual(
    calculateDayTypeEnergyTargets(2105, 0),
    { trainingDayKcal: 2105, restDayKcal: 2105 }
);
assert.equal(resolveDayEnergyTarget({
    baseKcal: 2200,
    trainingDayKcal: 2400,
    restDayKcal: 2050,
    trained: true
}), 2400);
assert.equal(resolveDayEnergyTarget({
    baseKcal: 2200,
    trainingDayKcal: 2400,
    restDayKcal: 2050,
    trained: false
}), 2050);
assert.equal(resolveDayEnergyTarget({
    baseKcal: 2200,
    trainingDayKcal: 0,
    restDayKcal: 0,
    trained: false
}), 2200);
assert.deepEqual(
    normalizeMacroPreferences({ strategy: 'manual', proteinPct: 40, carbPct: 30, fatPct: 30 }),
    { strategy: 'manual', proteinPct: 40, carbPct: 30, fatPct: 30 }
);
assert.deepEqual(
    calculateRecipeNutrition([
        { kcal: 200, protein: 30, carb: 5, fat: 6 },
        { kcal: 300, protein: 10, carb: 50, fat: 8 }
    ], 500, 300),
    { kcal: 300, protein: 24, carb: 33, fat: 8.4, fiber: 0, sugar: 0, sodium: 0 }
);
assert.deepEqual(
    createRecipeCatalogItem({
        id: 'tpl_smoothie',
        name: 'Sabah Smoothie’si',
        kind: 'recipe',
        servings: 2,
        yieldAmount: 500,
        yieldUnit: 'ml',
        nutritionConfidence: 'personal'
    }, [{
        kcal: 500,
        protein: 40,
        carb: 60,
        fat: 10,
        fiber: 8,
        sugar: 30,
        sodium: 250
    }]),
    {
        id: 'tpl_smoothie',
        name: 'Sabah Smoothie’si',
        type: 'drink',
        category: 'recipe',
        ref_amount: 100,
        kcal_100: 100,
        protein_100: 8,
        carb_100: 12,
        fat_100: 2,
        fiber_100: 1.6,
        sugar_100: 6,
        sodium_100: 50,
        nutrition_confidence: 'personal',
        nutrition_source: 'Kendi tarifin',
        search_aliases: ['tarif', 'hazır tarif'],
        is_recipe: true,
        recipe_id: 'tpl_smoothie',
        recipe_yield_unit: 'ml',
        recipe_default_amount: 250
    }
);
const gramRecipeCatalogItem = createRecipeCatalogItem({
    id: 'tpl_salad',
    name: 'Ton Balıklı Salata',
    kind: 'recipe',
    servings: 3,
    yieldAmount: 600,
    yieldUnit: 'g',
    nutritionConfidence: 'estimated'
}, [{ kcal: 720, protein: 90, carb: 45, fat: 20 }]);
assert.equal(gramRecipeCatalogItem.type, 'food');
assert.equal(gramRecipeCatalogItem.recipe_yield_unit, 'g');
assert.equal(gramRecipeCatalogItem.recipe_default_amount, 200);
assert.equal(gramRecipeCatalogItem.portion_grams, 200);
assert.equal(gramRecipeCatalogItem.kcal_100, 120);
assert.deepEqual(
    calculateRecipeNutrition([
        { kcal: 100, protein: 0, carb: 25, fat: 0, fiber: 4, sugar: 20, sodium: 800 }
    ], 200, 50),
    { kcal: 25, protein: 0, carb: 6.3, fat: 0, fiber: 1, sugar: 5, sodium: 200 }
);
assert.equal(sodiumMgToSaltGrams(800), 2);
assert.equal(sodiumMgToSaltGrams(-1), 0);
assert.equal(inferNutritionConfidence({ name: 'Ton Balıklı Salata' }), 'estimated');
assert.match(
    getMacroGuidance(
        { protein: 100, carb: 190, fat: 75 },
        { protein: 160, carb: 200, fat: 80 }
    ),
    /yağ hedefin dolmak üzere/i
);
assert.equal(calcMovingAverage([
    { weight: 80 }, { weight: 79 }, { weight: 78 }
], 2), 78.5);
assert.deepEqual(sumLogs([
    { kcal: 420, protein: 30, carb: 40, fat: 12 },
    { kcal: 180, protein: 10.5, carb: 20, fat: 5.5 },
    { kcal: -50, protein: 'bozuk', carb: Number.NaN, fat: -1 }
]), {
    kcal: 600,
    protein: 40.5,
    carb: 60,
    fat: 17.5,
    fiber: 0,
    sugar: 0,
    sodium: 0
});
assert.deepEqual(sumLogs([
    { kcal: 100, sugar: 12.5, sodium: 240, fiber: 3 },
    { kcal: 50, sugar: 2.5, sodium: 60, fiber: 1 }
]), {
    kcal: 150,
    protein: 0,
    carb: 0,
    fat: 0,
    fiber: 4,
    sugar: 15,
    sodium: 300
});
assert.deepEqual(sumIngredientAmounts([
    { type: 'food', grams: 125 },
    { type: 'drink', grams: 400 },
    { type: 'food', grams: -1 }
]), { g: 125, ml: 400, combined: 525 });

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
