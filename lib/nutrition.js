export const KCAL_PER_KG = 7700;

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function calculateNutrition(item, amount) {
    const rawReferenceAmount = Number(item?.ref_amount);
    const referenceAmount = Number.isFinite(rawReferenceAmount) && rawReferenceAmount > 0
        ? rawReferenceAmount
        : 100;
    const safeAmount = Number(amount);
    const multiplier = Number.isFinite(safeAmount) && safeAmount > 0
        ? safeAmount / referenceAmount
        : 0;
    const nutrient = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    };

    return {
        kcal: Math.round(nutrient(item?.kcal_100) * multiplier),
        protein: Math.round(nutrient(item?.protein_100) * multiplier * 10) / 10,
        carb: Math.round(nutrient(item?.carb_100) * multiplier * 10) / 10,
        fat: Math.round(nutrient(item?.fat_100) * multiplier * 10) / 10
    };
}

// Mifflin-St Jeor
export function calcBMR(gender, weightKg, heightCm, age) {
    const base = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    return gender === 'male' ? base + 5 : base - 161;
}

export function calcTDEE(bmr, activityMultiplier, trainingDays = 0, steps = 0) {
    let tdee = bmr * activityMultiplier;

    // Aktivite çarpanı ana yaşam temposunu temsil eder. Antrenman ve adım
    // değerleri yalnızca küçük bir kişiselleştirme düzeltmesi olarak eklenir.
    tdee += (clamp(Number(trainingDays) || 0, 0, 7) * 120) / 7;

    if (Number(steps) > 0) {
        const stepAdjustment = clamp((Number(steps) - 6000) * 0.025, -150, 300);
        tdee += stepAdjustment;
    }

    return Math.round(tdee);
}

export function applyGoalMode(tdee, mode) {
    const modifiers = {
        cut_moderate: 0.85,
        cut_aggressive: 0.75,
        maintain: 1,
        bulk: 1.10
    };
    return Math.round(tdee * (modifiers[mode] || 1));
}

export function suggestProtein(weightKg, mode) {
    const multiplier = mode === 'cut_moderate' || mode === 'cut_aggressive' ? 2 : 1.8;
    return Math.round(weightKg * multiplier);
}

export function suggestFat(weightKg) {
    return Math.round(weightKg * 0.8);
}

export function suggestCarb(targetKcal, proteinG, fatG) {
    const remaining = targetKcal - (proteinG * 4) - (fatG * 9);
    return Math.max(0, Math.round(remaining / 4));
}

export function calcMovingAverage(entries, days = 7) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const recent = entries.slice(-Math.min(days, entries.length));
    return recent.reduce((sum, entry) => sum + Number(entry.weight || 0), 0) / recent.length;
}

function enumerateDates(startDate, endDate) {
    const dates = [];
    const cursor = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);

    while (cursor <= end) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        dates.push(`${year}-${month}-${day}`);
        cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
}

export function calcAdaptiveTDEE(weightEntries, calorieLogs, profile = {}) {
    const MIN_WEIGHT_ENTRIES = 7;
    const MIN_INTAKE_DAYS = 5;

    if (!Array.isArray(weightEntries) || weightEntries.length < MIN_WEIGHT_ENTRIES) return null;

    const sorted = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
    const analysisWindow = sorted.slice(-Math.min(14, sorted.length));
    const compareChunk = Math.max(3, Math.floor(analysisWindow.length / 2));
    if (analysisWindow.length < compareChunk * 2) return null;

    const firstChunk = analysisWindow.slice(0, compareChunk);
    const lastChunk = analysisWindow.slice(-compareChunk);
    const avgFirst = firstChunk.reduce((sum, entry) => sum + entry.weight, 0) / firstChunk.length;
    const avgLast = lastChunk.reduce((sum, entry) => sum + entry.weight, 0) / lastChunk.length;
    const deltaKg = avgLast - avgFirst;

    const startDate = firstChunk[0].date;
    const endDate = lastChunk[lastChunk.length - 1].date;
    const averageDateMs = (entries) => entries.reduce(
        (sum, entry) => sum + new Date(`${entry.date}T00:00:00`).getTime(),
        0
    ) / entries.length;
    const comparisonDaySpan = Math.max(
        1,
        (averageDateMs(lastChunk) - averageDateMs(firstChunk)) / 86400000
    );
    const weeklyChange = (deltaKg / comparisonDaySpan) * 7;
    const dailyStoredEnergyChange = (weeklyChange * KCAL_PER_KG) / 7;

    const dailyIntake = {};
    for (const log of calorieLogs || []) {
        if (log.date >= startDate && log.date <= endDate) {
            dailyIntake[log.date] = (dailyIntake[log.date] || 0) + Number(log.kcal || 0);
        }
    }

    const rangeDates = enumerateDates(startDate, endDate);
    const intakeValues = rangeDates
        .map(date => dailyIntake[date])
        .filter(value => Number.isFinite(value) && value > 0);

    if (intakeValues.length < Math.min(MIN_INTAKE_DAYS, rangeDates.length)) return null;

    const avgIntake = intakeValues.reduce((sum, value) => sum + value, 0) / intakeValues.length;

    // Enerji dengesi: depolanan enerji = alınan enerji - harcanan enerji.
    // Dolayısıyla TDEE = alınan enerji - depolanan enerji.
    let adaptiveTDEE = Math.round(avgIntake - dailyStoredEnergyChange);

    if (profile.gender && profile.weight && profile.height && profile.age) {
        const bmr = calcBMR(profile.gender, profile.weight, profile.height, profile.age);
        adaptiveTDEE = clamp(adaptiveTDEE, Math.round(bmr), Math.round(bmr * 2.5));
    }

    return {
        adaptiveTDEE,
        weeklyChange,
        avgIntake: Math.round(avgIntake),
        intakeDays: intakeValues.length
    };
}

export function sumLogs(logs) {
    const safeValue = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    };
    return (logs || []).reduce((totals, log) => {
        totals.kcal += safeValue(log.kcal);
        totals.protein += safeValue(log.protein);
        totals.carb += safeValue(log.carb);
        totals.fat += safeValue(log.fat);
        return totals;
    }, { kcal: 0, protein: 0, carb: 0, fat: 0 });
}
