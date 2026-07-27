import { foods } from '../data/foods.js';
import { drinks } from '../data/drinks.js';

const all = [
    ...foods.map(item => ({ ...item, type: 'food' })),
    ...drinks.map(item => ({ ...item, type: 'drink' }))
];
const required = ['id', 'name', 'kcal_100', 'protein_100', 'carb_100', 'fat_100'];
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

    for (const field of required.slice(2)) {
        if (!Number.isFinite(item[field]) || item[field] < 0) {
            errors.push(`${item.id}: ${field} geçersiz`);
        }
    }
}

const duplicateNames = Object.values(all.reduce((groups, item) => {
    const key = `${item.type}:${item.name.trim().toLocaleLowerCase('tr-TR')}`;
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
}, {})).filter(group => group.length > 1);

console.log(`${foods.length} yiyecek, ${drinks.length} içecek, toplam ${all.length} ürün`);
console.log(`${duplicateNames.length} yinelenen isim grubu (arayüzde kalori değeriyle ayrıştırılır)`);

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log('Zorunlu alanlar ve ürün kimlikleri geçerli.');
}
