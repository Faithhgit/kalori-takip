import { sumLogs } from './nutrition.js';

export function groupLogsByMeal(logs, mealTypes = ['breakfast', 'lunch', 'dinner', 'snack']) {
    const grouped = Object.fromEntries(mealTypes.map(type => [type, []]));
    for (const log of logs || []) {
        const key = mealTypes.includes(log?.meal_type) ? log.meal_type : 'snack';
        grouped[key].push(log);
    }
    return grouped;
}

export function getMealTotals(logs) {
    const totals = sumLogs(logs);
    return {
        kcal: Math.round(totals.kcal),
        protein: Math.round(totals.protein * 10) / 10,
        carb: Math.round(totals.carb * 10) / 10,
        fat: Math.round(totals.fat * 10) / 10
    };
}

export function getWeightAverages(entries, windows = [7, 14, 30]) {
    const sorted = [...(entries || [])]
        .filter(entry => Number.isFinite(Number(entry?.weight)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return Object.fromEntries(windows.map(days => {
        const recent = sorted.slice(-Math.min(days, sorted.length));
        const average = recent.length
            ? recent.reduce((sum, entry) => sum + Number(entry.weight), 0) / recent.length
            : null;
        return [days, average === null ? null : Math.round(average * 10) / 10];
    }));
}

export function getWeightDataRequirement(entries, minimum = 7) {
    const count = Array.isArray(entries) ? entries.length : 0;
    return {
        count,
        minimum,
        remaining: Math.max(0, minimum - count),
        ready: count >= minimum
    };
}

export function estimateGoalDate(entries, targetWeight) {
    const sorted = [...(entries || [])]
        .filter(entry => entry?.date && Number.isFinite(Number(entry.weight)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const target = Number(targetWeight);
    if (sorted.length < 7 || !Number.isFinite(target) || target <= 0) return null;

    const window = sorted.slice(-Math.min(30, sorted.length));
    const first = window[0];
    const last = window[window.length - 1];
    const daySpan = (new Date(`${last.date}T00:00:00`) - new Date(`${first.date}T00:00:00`)) / 86400000;
    if (daySpan < 6) return null;
    const dailyRate = (Number(last.weight) - Number(first.weight)) / daySpan;
    const remaining = target - Number(last.weight);
    if (Math.abs(dailyRate) < 0.005 || Math.sign(remaining) !== Math.sign(dailyRate)) return null;

    const days = Math.ceil(Math.abs(remaining / dailyRate));
    if (!Number.isFinite(days) || days <= 0 || days > 730) return null;
    const date = new Date(`${last.date}T00:00:00`);
    date.setDate(date.getDate() + days);
    return { date: date.toISOString().slice(0, 10), days, weeklyRate: dailyRate * 7 };
}

export function calculateWeeklyBudget(logs, dailyTargets, dates) {
    const targetForDate = typeof dailyTargets === 'function'
        ? dailyTargets
        : () => Number(dailyTargets) || 0;
    const intakeByDate = {};
    for (const log of logs || []) {
        intakeByDate[log.date] = (intakeByDate[log.date] || 0) + Number(log.kcal || 0);
    }
    const target = (dates || []).reduce((sum, date) => sum + targetForDate(date), 0);
    const consumed = (dates || []).reduce((sum, date) => sum + (intakeByDate[date] || 0), 0);
    return {
        target: Math.round(target),
        consumed: Math.round(consumed),
        remaining: Math.round(target - consumed),
        percentage: target > 0 ? Math.round((consumed / target) * 100) : 0
    };
}

export function calculateMacroAdherence(logs, targets, dates) {
    const totals = sumLogs(logs);
    const result = {};
    for (const key of ['protein', 'carb', 'fat']) {
        const target = typeof targets === 'function'
            ? (dates || []).reduce((sum, date) => sum + Number(targets(date)?.[key] || 0), 0)
            : Number(targets?.[key]) * Math.max(1, (dates || []).length);
        const actual = totals[key];
        result[key] = {
            target: Math.round(target * 10) / 10,
            actual: Math.round(actual * 10) / 10,
            percentage: target > 0 ? Math.round((actual / target) * 100) : 0
        };
    }
    return result;
}

export function getCalorieStatus(kcal, target) {
    const ratio = Number(target) > 0 ? Number(kcal) / Number(target) : 0;
    if (ratio === 0) return 'empty';
    if (ratio < 0.7) return 'low';
    if (ratio <= 1.15) return 'on-target';
    return 'high';
}

export function getCalorieGuidance(kcal, target) {
    const status = getCalorieStatus(kcal, target);
    if (status === 'low') return 'Enerji hedefinin belirgin şekilde altındasın. Öğünlerinin yeterliliğini kontrol et.';
    if (status === 'high') return 'Bugün hedefin üzerindesin; tek gün yerine haftalık ortalamaya odaklan.';
    if (status === 'on-target') return 'Bugünkü enerji alımın hedef aralığında.';
    return 'Günlük değerlendirme için en az bir öğün kaydet.';
}
