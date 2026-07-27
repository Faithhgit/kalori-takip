export const AI_CONTEXT_VERSION = 1;

const GOAL_CODES = Object.freeze({
    cut_moderate: 'cm',
    cut_aggressive: 'ca',
    maintain: 'm',
    bulk: 'b'
});

const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const oneDecimal = value => Math.round(finite(value) * 10) / 10;

/*
 * Token-dostu sabit sıra:
 * [
 *   sürüm,
 *   [kilo, boy, yaş, hedefKilo, hedefKodu],
 *   [dinlenmeKcal, antrenmanKcal, protein, karbonhidrat, yağ],
 *   [[günFarkı, kcal, hedefKcal, protein, karbonhidrat, yağ, lif, şeker, tuz, antrenman, kayıtSayısı], ...],
 *   [sonKilo, ort7, ort14, ort30, haftalıkDeğişim]
 * ]
 */
export function buildCompactAiContext({
    profile = {},
    targets = {},
    days = [],
    weight = {}
} = {}) {
    return [
        AI_CONTEXT_VERSION,
        [
            oneDecimal(profile.weight),
            oneDecimal(profile.height),
            Math.round(finite(profile.age)),
            oneDecimal(profile.targetWeight),
            GOAL_CODES[profile.goalMode] || 'm'
        ],
        [
            Math.round(finite(targets.restKcal)),
            Math.round(finite(targets.trainingKcal)),
            Math.round(finite(targets.protein)),
            Math.round(finite(targets.carb)),
            Math.round(finite(targets.fat))
        ],
        (Array.isArray(days) ? days : []).slice(-7).map(day => [
            Math.round(finite(day.offset)),
            Math.round(finite(day.kcal)),
            Math.round(finite(day.targetKcal)),
            oneDecimal(day.protein),
            oneDecimal(day.carb),
            oneDecimal(day.fat),
            oneDecimal(day.fiber),
            oneDecimal(day.sugar),
            oneDecimal(day.salt),
            day.trained ? 1 : 0,
            Math.max(0, Math.round(finite(day.count)))
        ]),
        [
            oneDecimal(weight.current),
            oneDecimal(weight.avg7),
            oneDecimal(weight.avg14),
            oneDecimal(weight.avg30),
            oneDecimal(weight.weeklyChange)
        ]
    ];
}
