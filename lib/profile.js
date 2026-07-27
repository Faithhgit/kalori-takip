const ACTIVITIES = Object.freeze([1.2, 1.375, 1.55, 1.725]);
const GOAL_MODES = Object.freeze(['cut_moderate', 'cut_aggressive', 'maintain', 'bulk']);

function numberInRange(value, min, max, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

export function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return {};

    const activity = Number(profile.activity);
    const trainingWeekdays = [...new Set(
        String(Array.isArray(profile.trainingWeekdays)
            ? profile.trainingWeekdays.join(',')
            : profile.trainingWeekdays || '')
            .split(',')
            .map(value => Number(value.trim()))
            .filter(value => Number.isInteger(value) && value >= 1 && value <= 7)
    )].sort((a, b) => a - b);

    return {
        gender: ['male', 'female'].includes(profile.gender) ? profile.gender : '',
        age: numberInRange(profile.age, 15, 80),
        height: numberInRange(profile.height, 120, 220),
        weight: numberInRange(profile.weight, 40, 200),
        activity: ACTIVITIES.includes(activity) ? activity : 1.2,
        trainingDays: numberInRange(profile.trainingDays, 0, 7),
        steps: numberInRange(profile.steps, 0, 50000),
        goalMode: GOAL_MODES.includes(profile.goalMode) ? profile.goalMode : 'maintain',
        targetWeight: numberInRange(profile.targetWeight, 35, 250),
        trainingWeekdays,
        trainingDayKcal: numberInRange(profile.trainingDayKcal, 1000, 5000),
        restDayKcal: numberInRange(profile.restDayKcal, 1000, 5000)
    };
}

export function validateCompleteProfile(profile) {
    const integerInRange = (value, min, max) =>
        Number.isInteger(Number(value || 0))
        && numberInRange(value || 0, min, max, Number.NaN) === Number(value || 0);

    if (
        !['male', 'female'].includes(profile?.gender)
        || !Number.isFinite(numberInRange(profile?.age, 15, 80, Number.NaN))
        || !Number.isFinite(numberInRange(profile?.height, 120, 220, Number.NaN))
        || !Number.isFinite(numberInRange(profile?.weight, 40, 200, Number.NaN))
        || !ACTIVITIES.includes(Number(profile?.activity))
        || !integerInRange(profile?.trainingDays, 0, 7)
        || !integerInRange(profile?.steps, 0, 50000)
        || !GOAL_MODES.includes(profile?.goalMode)
    ) {
        return 'Profil bilgilerini alanlarda belirtilen geçerli aralıklarda tamamla.';
    }
    return '';
}
