import { randomUUID } from 'node:crypto';
import { firebaseConfig } from '../firebase-config.js';
import { foods } from '../data/foods.js';
import { drinks } from '../data/drinks.js';
import { calculateNutrition } from '../lib/nutrition.js';
import { buildDemoDataset } from '../lib/demo-data.js';

const command = process.argv[2];
if (!['seed', 'clear'].includes(command)) {
    throw new Error('Kullanım: node scripts/firestore-demo.mjs seed|clear');
}

const projectId = firebaseConfig.projectId;
const apiKey = firebaseConfig.apiKey;
const databaseRoot = `projects/${projectId}/databases/(default)`;
const apiRoot = `https://firestore.googleapis.com/v1/${databaseRoot}`;
const catalog = new Map([...foods, ...drinks].map(item => [item.id, item]));

async function firestoreFetch(path, options = {}) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${apiRoot}${path}${separator}key=${encodeURIComponent(apiKey)}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || `Firestore ${response.status}`);
    }
    return data;
}

async function listDocuments(collectionName) {
    const documents = [];
    let pageToken = '';
    do {
        const query = new URLSearchParams({ pageSize: '300' });
        if (pageToken) query.set('pageToken', pageToken);
        const result = await firestoreFetch(`/documents/${collectionName}?${query}`);
        documents.push(...(result.documents || []));
        pageToken = result.nextPageToken || '';
    } while (pageToken);
    return documents;
}

async function batchWrite(writes) {
    for (let start = 0; start < writes.length; start += 20) {
        await Promise.all(writes.slice(start, start + 20).map(write => {
            if (write.delete) {
                const path = write.delete.split('/documents/')[1];
                return firestoreFetch(`/documents/${path}`, { method: 'DELETE' });
            }
            const path = write.update.name.split('/documents/')[1];
            const parts = path.split('/');
            const documentId = parts.pop();
            const collectionPath = parts.join('/');
            return firestoreFetch(
                `/documents/${collectionPath}?documentId=${encodeURIComponent(documentId)}`,
                {
                    method: 'POST',
                    body: JSON.stringify({ fields: write.update.fields })
                }
            );
        }));
    }
}

const isDemoDocument = document =>
    document?.fields?.is_demo?.booleanValue === true;

function numberValue(value) {
    const number = Number(value) || 0;
    return Number.isInteger(number)
        ? { integerValue: String(number) }
        : { doubleValue: number };
}

function stringValue(value) {
    return { stringValue: String(value ?? '') };
}

function mapNumber(field) {
    return Number(field?.integerValue ?? field?.doubleValue ?? field?.stringValue ?? 0) || 0;
}

async function readSettings() {
    try {
        return await firestoreFetch('/documents/app_settings/default_settings');
    } catch (error) {
        if (/not found/i.test(error.message)) return { fields: {} };
        throw error;
    }
}

async function patchDailyMeta(metaFields) {
    await firestoreFetch(
        '/documents/app_settings/default_settings?updateMask.fieldPaths=daily_meta&updateMask.fieldPaths=updated_at',
        {
            method: 'PATCH',
            body: JSON.stringify({
                name: `${databaseRoot}/documents/app_settings/default_settings`,
                fields: {
                    daily_meta: { mapValue: { fields: metaFields } },
                    updated_at: { timestampValue: new Date().toISOString() }
                }
            })
        }
    );
}

async function clearDemoData() {
    const [logs, weights, settings] = await Promise.all([
        listDocuments('daily_logs'),
        listDocuments('weight_logs'),
        readSettings()
    ]);
    const demoDocuments = [...logs, ...weights].filter(isDemoDocument);
    await batchWrite(demoDocuments.map(document => ({
        delete: document.name
    })));

    const metaFields = settings?.fields?.daily_meta?.mapValue?.fields || {};
    const nextMeta = Object.fromEntries(
        Object.entries(metaFields).filter(([, value]) =>
            value?.mapValue?.fields?.is_demo?.booleanValue !== true
        )
    );
    if (Object.keys(nextMeta).length !== Object.keys(metaFields).length) {
        await patchDailyMeta(nextMeta);
    }
    return demoDocuments.length;
}

function nutritionFields(item, amount) {
    const core = calculateNutrition(item, amount);
    const reference = Number(item.ref_amount) > 0 ? Number(item.ref_amount) : 100;
    const multiplier = Number(amount) / reference;
    const optional = field => Math.round((Number(item[field]) || 0) * multiplier * 10) / 10;
    return {
        kcal: numberValue(core.kcal),
        protein: numberValue(core.protein),
        carb: numberValue(core.carb),
        fat: numberValue(core.fat),
        fiber: numberValue(optional('fiber_100')),
        sugar: numberValue(optional('sugar_100')),
        sodium: numberValue(optional('sodium_100'))
    };
}

async function seedDemoData() {
    await clearDemoData();
    const settings = await readSettings();
    const profileFields = settings?.fields?.profile?.mapValue?.fields || {};
    const profileWeight = mapNumber(profileFields.weight) || 100;
    const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    const dataset = buildDemoDataset({
        today,
        profileWeight,
        batchId: `demo_${randomUUID()}`
    });
    const now = new Date().toISOString();
    const writes = [];

    dataset.logs.forEach(entry => {
        const item = catalog.get(entry.itemId);
        if (!item) throw new Error(`Demo besini bulunamadı: ${entry.itemId}`);
        const itemType = drinks.some(drink => drink.id === item.id) ? 'drink' : 'food';
        writes.push({
            update: {
                name: `${databaseRoot}/documents/daily_logs/demo_${randomUUID()}`,
                fields: {
                    date: stringValue(entry.date),
                    item_id: stringValue(item.id),
                    item_name: stringValue(item.name),
                    grams: numberValue(entry.amount),
                    item_type: stringValue(itemType),
                    unit: stringValue(itemType === 'drink' ? 'ml' : 'g'),
                    display_amount: numberValue(entry.amount),
                    display_unit: stringValue(itemType === 'drink' ? 'ml' : 'g'),
                    meal_type: stringValue(entry.mealType),
                    nutrition_confidence: stringValue(item.nutrition_confidence || 'verified'),
                    nutrition_source: stringValue(item.nutrition_source || 'Denge kataloğu'),
                    schema_version: numberValue(3),
                    is_demo: { booleanValue: true },
                    demo_batch_id: stringValue(dataset.batchId),
                    demo_version: numberValue(dataset.version),
                    ...nutritionFields(item, entry.amount),
                    created_at: { timestampValue: now }
                }
            }
        });
    });
    dataset.weights.forEach(entry => {
        writes.push({
            update: {
                name: `${databaseRoot}/documents/weight_logs/demo_${randomUUID()}`,
                fields: {
                    date: stringValue(entry.date),
                    weight: numberValue(entry.weight),
                    is_demo: { booleanValue: true },
                    demo_batch_id: stringValue(dataset.batchId),
                    demo_version: numberValue(dataset.version),
                    updated_at: { timestampValue: now }
                }
            }
        });
    });
    await batchWrite(writes);

    const existingMeta = settings?.fields?.daily_meta?.mapValue?.fields || {};
    const nextMeta = { ...existingMeta };
    Object.entries(dataset.dailyMeta).forEach(([date, meta]) => {
        if (nextMeta[date]) return;
        nextMeta[date] = {
            mapValue: {
                fields: {
                    date: stringValue(date),
                    trained: { booleanValue: meta.trained },
                    is_demo: { booleanValue: true },
                    demo_batch_id: stringValue(dataset.batchId),
                    demo_version: numberValue(dataset.version),
                    updated_at: { timestampValue: now }
                }
            }
        };
    });
    await patchDailyMeta(nextMeta);
    return {
        days: dataset.days.length,
        logs: dataset.logs.length,
        weights: dataset.weights.length
    };
}

if (command === 'clear') {
    const deleted = await clearDemoData();
    console.log(`Demo temizlendi: ${deleted} belge.`);
} else {
    const result = await seedDemoData();
    console.log(`Demo oluşturuldu: ${result.days} gün, ${result.logs} besin kaydı, ${result.weights} kilo ölçümü.`);
}
