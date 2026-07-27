export const DEMO_DATA_VERSION = 1;

const DAY_FACTORS = [0.92, 1.04, 0.97, 1.1, 0.88, 1.02, 1.15, 0.95, 1.06, 0.9, 1.12, 0.98, 1.04, 0.93, 1.08];

const MEAL_PATTERNS = [
    [
        ['food_oats_dry', 60, 'breakfast'],
        ['drink_pinar_protein_plain', 400, 'breakfast'],
        ['food_banana_raw', 100, 'breakfast'],
        ['food_chicken_breast_cooked', 210, 'lunch'],
        ['food_rice_white_cooked', 220, 'lunch'],
        ['food_broccoli_raw', 150, 'lunch'],
        ['food_olive_oil', 10, 'lunch'],
        ['food_yogurt_plain', 200, 'snack'],
        ['food_almonds_raw', 20, 'snack'],
        ['food_tuna_water_drained', 150, 'dinner'],
        ['food_bread_wholewheat', 75, 'dinner'],
        ['food_tomato_raw', 150, 'dinner']
    ],
    [
        ['food_egg_boiled', 165, 'breakfast'],
        ['food_bread_wholewheat', 75, 'breakfast'],
        ['food_avocado_raw', 70, 'breakfast'],
        ['food_chicken_thigh_cooked', 190, 'lunch'],
        ['food_pasta_wholewheat_cooked', 230, 'lunch'],
        ['food_tomato_raw', 150, 'lunch'],
        ['food_olive_oil', 8, 'lunch'],
        ['food_apple_raw', 180, 'snack'],
        ['food_yogurt_strained', 180, 'snack'],
        ['food_lentils_cooked', 280, 'dinner'],
        ['food_bread_wholewheat', 50, 'dinner']
    ],
    [
        ['food_oats_dry', 55, 'breakfast'],
        ['drink_pinar_protein_coffee', 350, 'breakfast'],
        ['food_strawberry_raw', 150, 'breakfast'],
        ['food_beef_lean_cooked', 180, 'lunch'],
        ['food_bulgur_cooked', 240, 'lunch'],
        ['food_cucumber_raw', 150, 'lunch'],
        ['food_olive_oil', 10, 'lunch'],
        ['food_banana_raw', 100, 'snack'],
        ['food_walnuts_raw', 18, 'snack'],
        ['food_yogurt_plain', 250, 'dinner'],
        ['food_chickpeas_cooked', 220, 'dinner'],
        ['food_tomato_raw', 120, 'dinner']
    ]
];

function shiftIsoDate(isoDate, offset) {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const oneDecimal = value => Math.round(Number(value) * 10) / 10;

export function buildDemoDataset({
    today,
    profileWeight = 100,
    batchId = `demo_${Date.now()}`
} = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
        throw new Error('Demo verisi için geçerli bir tarih gerekli.');
    }

    const safeWeight = Number.isFinite(Number(profileWeight))
        ? Math.min(250, Math.max(30, Number(profileWeight)))
        : 100;
    const days = Array.from({ length: 15 }, (_, index) => {
        const date = shiftIsoDate(today, index - 14);
        const factor = DAY_FACTORS[index];
        const trained = [1, 3, 6].includes(index % 7);
        const pattern = MEAL_PATTERNS[index % MEAL_PATTERNS.length];
        return {
            date,
            trained,
            logs: pattern.map(([itemId, amount, mealType]) => ({
                date,
                itemId,
                amount: oneDecimal(amount * factor),
                mealType
            })),
            weight: {
                date,
                weight: oneDecimal(safeWeight + ((14 - index) * 0.075) + ([0, 0.08, -0.05][index % 3]))
            }
        };
    });

    return {
        version: DEMO_DATA_VERSION,
        batchId,
        days,
        logs: days.flatMap(day => day.logs),
        weights: days.map(day => day.weight),
        dailyMeta: Object.fromEntries(days.map(day => [
            day.date,
            {
                date: day.date,
                trained: day.trained,
                is_demo: true,
                demo_batch_id: batchId,
                demo_version: DEMO_DATA_VERSION
            }
        ]))
    };
}
