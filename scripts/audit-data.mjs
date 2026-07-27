import { foods } from '../data/foods.js';
import { drinks } from '../data/drinks.js';

const all = [
    ...foods.map(item => ({ ...item, type: 'food' })),
    ...drinks.map(item => ({ ...item, type: 'drink' }))
];
const required = [
    'id',
    'name',
    'category',
    'kcal_100',
    'protein_100',
    'carb_100',
    'fat_100',
    'fiber_100',
    'sugar_100',
    'sodium_100',
    'nutrition_source',
    'nutrition_confidence'
];
const numericFields = [
    'kcal_100',
    'protein_100',
    'carb_100',
    'fat_100',
    'fiber_100',
    'sugar_100',
    'sodium_100'
];
const errors = [];
const ids = new Set();

for (const item of all) {
    for (const field of required) {
        if (item[field] === undefined || item[field] === null || item[field] === '') {
            errors.push(`${item.id || '(id yok)'}: ${field} eksik`);
        }
    }
    if (ids.has(item.id)) errors.push(`${item.id}: yinelenen id`);
    ids.add(item.id);

    for (const field of numericFields) {
        if (!Number.isFinite(item[field]) || item[field] < 0) {
            errors.push(`${item.id}: ${field} geçersiz`);
        }
    }

    if (item.sugar_100 > item.carb_100 + 0.1) {
        errors.push(`${item.id}: şeker karbonhidrattan büyük`);
    }
    if (!['verified', 'personal', 'estimated'].includes(item.nutrition_confidence)) {
        errors.push(`${item.id}: nutrition_confidence geçersiz`);
    }

    const macroKcal = (item.protein_100 * 4) + (item.carb_100 * 4) + (item.fat_100 * 9);
    const isVeryHighFiber = item.carb_100 > 0 && (item.fiber_100 / item.carb_100) > 0.5;
    const allowedDifference = isVeryHighFiber
        ? Math.max(220, item.kcal_100)
        : Math.max(40, item.kcal_100 * 0.4);
    if (item.kcal_100 > 0 && Math.abs(macroKcal - item.kcal_100) > allowedDifference) {
        errors.push(`${item.id}: enerji ile makrolar tutarsız (${item.kcal_100} / ${macroKcal.toFixed(1)} kcal)`);
    }
}

const duplicateNames = Object.values(all.reduce((groups, item) => {
    const key = `${item.type}:${item.name.trim().toLocaleLowerCase('tr-TR')}`;
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
}, {})).filter(group => group.length > 1);

if (duplicateNames.length > 0) {
    for (const group of duplicateNames) {
        errors.push(`Yinelenen isim: ${group.map(item => item.name).join(', ')}`);
    }
}

console.log(`${foods.length} yiyecek, ${drinks.length} içecek, toplam ${all.length} ürün`);
console.log(`${duplicateNames.length} yinelenen isim grubu`);

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log('Zorunlu alanlar, besin değerleri ve ürün kimlikleri geçerli.');
}
