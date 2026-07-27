const roundOne = value => Math.round((Number(value) || 0) * 10) / 10;

export const DEFAULT_MACRO_PREFERENCES = Object.freeze({
    strategy: 'protein_focused',
    proteinPct: 35,
    carbPct: 35,
    fatPct: 30
});

export const MACRO_PRESETS = Object.freeze({
    protein_focused: Object.freeze({ proteinPct: 35, carbPct: 35, fatPct: 30 }),
    balanced: Object.freeze({ proteinPct: 30, carbPct: 40, fatPct: 30 }),
    lower_carb: Object.freeze({ proteinPct: 35, carbPct: 25, fatPct: 40 })
});

export function normalizeMacroPreferences(raw) {
    const strategy = ['protein_focused', 'balanced', 'lower_carb', 'manual']
        .includes(raw?.strategy)
        ? raw.strategy
        : DEFAULT_MACRO_PREFERENCES.strategy;

    if (strategy !== 'manual') {
        return { strategy, ...MACRO_PRESETS[strategy] };
    }

    const proteinPct = Number(raw?.proteinPct);
    const carbPct = Number(raw?.carbPct);
    const fatPct = Number(raw?.fatPct);
    const values = [proteinPct, carbPct, fatPct];
    const valid = values.every(value => Number.isFinite(value) && value >= 10 && value <= 60)
        && Math.round(values.reduce((sum, value) => sum + value, 0)) === 100;

    return valid
        ? { strategy, proteinPct, carbPct, fatPct }
        : { ...DEFAULT_MACRO_PREFERENCES };
}

export function calculateGoalTarget(baseTarget, goalMode, reductionRate = 0.07) {
    const target = Number(baseTarget);
    if (!Number.isFinite(target) || target <= 0) return 0;
    const shouldReduce = goalMode === 'cut_moderate' || goalMode === 'cut_aggressive';
    const rate = Math.min(0.15, Math.max(0, Number(reductionRate) || 0));
    const adjusted = shouldReduce ? target * (1 - rate) : target;
    return Math.round(adjusted / 5) * 5;
}

export function calculateMacroTargets(kcal, preferences) {
    const energy = Math.max(0, Number(kcal) || 0);
    const prefs = normalizeMacroPreferences(preferences);
    return {
        protein: Math.round((energy * prefs.proteinPct / 100) / 4),
        carb: Math.round((energy * prefs.carbPct / 100) / 4),
        fat: Math.round((energy * prefs.fatPct / 100) / 9)
    };
}

export function calculateDayTypeEnergyTargets(baseKcal, trainingDays, spread = 250) {
    const base = Math.min(5000, Math.max(1000, Number(baseKcal) || 0));
    const days = Math.min(7, Math.max(0, Math.round(Number(trainingDays) || 0)));
    if (!base || days === 0 || days === 7) {
        return { trainingDayKcal: base, restDayKcal: base };
    }

    const requestedSpread = Math.max(0, Number(spread) || 0);
    const maxSpreadFromTraining = ((5000 - base) * 7) / (7 - days);
    const maxSpreadFromRest = ((base - 1000) * 7) / days;
    const effectiveSpread = Math.min(requestedSpread, maxSpreadFromTraining, maxSpreadFromRest);
    const roundToFive = value => Math.round(value / 5) * 5;

    return {
        trainingDayKcal: roundToFive(base + (effectiveSpread * (7 - days) / 7)),
        restDayKcal: roundToFive(base - (effectiveSpread * days / 7))
    };
}

export function resolveDayEnergyTarget({
    baseKcal,
    trainingDayKcal,
    restDayKcal,
    trained = false
}) {
    const base = Math.max(0, Number(baseKcal) || 0);
    const training = Number(trainingDayKcal);
    const rest = Number(restDayKcal);
    if (trained && Number.isFinite(training) && training >= 1000 && training <= 5000) {
        return training;
    }
    if (!trained && Number.isFinite(rest) && rest >= 1000 && rest <= 5000) {
        return rest;
    }
    return base;
}

export function sumNutrition(values) {
    return (values || []).reduce((totals, value) => ({
        kcal: totals.kcal + (Number(value?.kcal) || 0),
        protein: totals.protein + (Number(value?.protein) || 0),
        carb: totals.carb + (Number(value?.carb) || 0),
        fat: totals.fat + (Number(value?.fat) || 0),
        fiber: totals.fiber + (Number(value?.fiber) || 0),
        sugar: totals.sugar + (Number(value?.sugar) || 0),
        sodium: totals.sodium + (Number(value?.sodium) || 0)
    }), { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 });
}

export function sumIngredientAmounts(items) {
    return (items || []).reduce((totals, item) => {
        const amount = Number(item?.grams);
        if (!Number.isFinite(amount) || amount <= 0) return totals;
        if (item.type === 'drink') {
            totals.ml += amount;
        } else {
            totals.g += amount;
        }
        totals.combined += amount;
        return totals;
    }, { g: 0, ml: 0, combined: 0 });
}

export function sodiumMgToSaltGrams(sodiumMg) {
    const sodium = Number(sodiumMg);
    if (!Number.isFinite(sodium) || sodium <= 0) return 0;
    return roundOne((sodium * 2.5) / 1000);
}

export function calculateRecipeNutrition(ingredientNutrition, yieldAmount, consumedAmount) {
    const totalYield = Number(yieldAmount);
    const consumed = Number(consumedAmount);
    if (!Number.isFinite(totalYield) || totalYield <= 0 || !Number.isFinite(consumed) || consumed <= 0) {
        return { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
    }

    const totals = sumNutrition(ingredientNutrition);
    const ratio = consumed / totalYield;
    return {
        kcal: Math.round(totals.kcal * ratio),
        protein: roundOne(totals.protein * ratio),
        carb: roundOne(totals.carb * ratio),
        fat: roundOne(totals.fat * ratio),
        fiber: roundOne(totals.fiber * ratio),
        sugar: roundOne(totals.sugar * ratio),
        sodium: roundOne(totals.sodium * ratio)
    };
}

export function createRecipeCatalogItem(template, ingredientNutrition) {
    if (template?.kind !== 'recipe') return null;

    const id = String(template.id || '').trim();
    const name = String(template.name || '').trim();
    const yieldAmount = Number(template.yieldAmount);
    const servings = Math.max(1, Number(template.servings) || 1);
    if (!id || !name || !Number.isFinite(yieldAmount) || yieldAmount <= 0) return null;

    const nutritionPer100 = calculateRecipeNutrition(ingredientNutrition, yieldAmount, 100);
    const type = template.yieldUnit === 'ml' ? 'drink' : 'food';
    const defaultAmount = Math.round((yieldAmount / servings) * 10) / 10;

    return {
        id,
        name,
        type,
        category: 'recipe',
        ref_amount: 100,
        kcal_100: nutritionPer100.kcal,
        protein_100: nutritionPer100.protein,
        carb_100: nutritionPer100.carb,
        fat_100: nutritionPer100.fat,
        fiber_100: nutritionPer100.fiber,
        sugar_100: nutritionPer100.sugar,
        sodium_100: nutritionPer100.sodium,
        nutrition_confidence: template.nutritionConfidence === 'estimated' ? 'estimated' : 'personal',
        nutrition_source: 'Kendi tarifin',
        search_aliases: ['tarif', 'hazır tarif'],
        is_recipe: true,
        recipe_id: id,
        recipe_yield_unit: type === 'drink' ? 'ml' : 'g',
        recipe_default_amount: defaultAmount,
        ...(type === 'food' ? { portion_grams: defaultAmount } : {})
    };
}

export function inferNutritionConfidence(item) {
    if (['verified', 'personal', 'estimated'].includes(item?.nutrition_confidence)) {
        return item.nutrition_confidence;
    }
    if (String(item?.id || '').startsWith('custom_')) return 'verified';

    const name = String(item?.name || '').toLocaleLowerCase('tr-TR');
    const mixedFoodTerms = [
        'salata', 'smoothie', 'makarna', 'sandviç', 'sandvic', 'dürüm', 'durum',
        'pizza', 'burger', 'börek', 'borek', 'çorba', 'corba', 'pilav üstü',
        'kase', 'bowl', 'menemen', 'omlet'
    ];
    return mixedFoodTerms.some(term => name.includes(term)) ? 'estimated' : 'verified';
}

export function getNutritionConfidenceLabel(confidence) {
    if (confidence === 'personal') return 'Kişisel tarif';
    if (confidence === 'estimated') return 'Tahmini';
    return 'Net değer';
}

export function getMacroGuidance(totals, targets) {
    const proteinRemaining = Math.max(0, Math.round(Number(targets?.protein || 0) - Number(totals?.protein || 0)));
    const carbRatio = Number(targets?.carb) > 0 ? Number(totals?.carb || 0) / Number(targets.carb) : 0;
    const fatRatio = Number(targets?.fat) > 0 ? Number(totals?.fat || 0) / Number(targets.fat) : 0;

    if (proteinRemaining >= 20 && fatRatio >= 0.85) {
        return `${proteinRemaining} g protein kaldı. Yağ hedefin dolmak üzere; sonraki öğünde daha yağsız bir protein seç.`;
    }
    if (proteinRemaining >= 20 && carbRatio >= 0.9) {
        return `${proteinRemaining} g protein kaldı. Karbonhidrat hedefin dolmak üzere; sonraki öğünü protein ağırlıklı kur.`;
    }
    if (proteinRemaining >= 20) {
        return `${proteinRemaining} g protein kaldı. Sonraki öğünde protein kaynağını önce seç.`;
    }
    if (fatRatio > 1 || carbRatio > 1) {
        return 'Protein hedefin tamam. Günün kalanında daha sade ve dengeli seçimler yap.';
    }
    return 'Makro dağılımın hedefinle uyumlu ilerliyor.';
}
