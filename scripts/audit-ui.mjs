import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicates, [], `Yinelenen HTML id değerleri: ${duplicates.join(', ')}`);

const referencedIds = [...app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)]
    .map(match => match[1]);
const missingIds = [...new Set(referencedIds.filter(id => !ids.includes(id)))];
assert.deepEqual(missingIds, [], `HTML'de bulunmayan arayüz bağları: ${missingIds.join(', ')}`);

const buttonTags = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
const implicitButtons = buttonTags.filter(tag => !/\btype=/.test(tag) && !/\bonclick=/.test(tag));
assert.equal(implicitButtons.length, 0, 'Form davranışı belirsiz type alanı olmayan buton bulundu.');

assert.match(html, /<html lang="tr">/, 'Sayfa dili belirtilmeli.');
assert.match(html, /name="viewport"/, 'Mobil viewport etiketi bulunmalı.');
assert.match(css, /env\(safe-area-inset-bottom\)/, 'Mobil güvenli alan desteği bulunmalı.');
assert.match(css, /:focus-visible/, 'Klavye odak stili bulunmalı.');
assert.match(html, /aria-live="polite"/, 'Dinamik durum mesajları erişilebilir olmalı.');
assert.match(html, /id="mealPickerModal"/, 'Öğün seçim penceresi bulunmalı.');
assert.equal(
    [...html.matchAll(/data-meal-choice="(breakfast|lunch|dinner|snack)"/g)].length,
    4,
    'Dört öğün seçeneğinin tamamı bulunmalı.'
);
assert.ok(
    [...app.matchAll(/await requestMealSelection\(/g)].length >= 4,
    'Günlüğe ekleme yolları öğün seçimini istemeli.'
);
assert.equal(
    [...html.matchAll(/class="catalog-filter-btn(?: active)?"/g)].length,
    2,
    'Besin kütüphanesinde yalnızca yiyecek ve içecek filtreleri bulunmalı.'
);
assert.match(
    html,
    /class="catalog-view-btn active"[^>]+data-catalog-view="templates"/,
    'Besinler sayfasında öğünler ve tarifler ilk görünüm olmalı.'
);
assert.match(css, /scrollbar-width:\s*none/, 'Kaydırma çubukları görünmeden kaydırma desteklenmeli.');
assert.equal(
    [...html.matchAll(/<details class="settings-accordion[^"]*"/g)].length,
    3,
    'Ayarlar profil, günlük hedefler ve veriler olarak üç bölüme ayrılmalı.'
);
assert.match(
    css,
    /\.main-content \.summary-card\[data-page="dashboard"\][\s\S]*grid-column:\s*1\s*\/\s*13/,
    'Enerji özeti masaüstünde tam genişlik kullanmalı.'
);
for (const id of ['calorieRingStatus', 'dailySugarValue', 'dailySaltValue', 'templateNutritionPreview']) {
    assert.ok(ids.includes(id), `${id} arayüz alanı bulunmalı.`);
}
for (const id of ['createDemoDataBtn', 'removeDemoDataBtn', 'demoDataStatus']) {
    assert.ok(ids.includes(id), `${id} demo veri kontrolü bulunmalı.`);
}
for (const id of [
    'assistant-tab',
    'assistantInput',
    'assistantSend',
    'assistantCommandResult',
    'assistantUsage',
    'assistantReviewBtn',
    'assistantMealSuggestionBtn',
    'assistantReviewResult'
]) {
    assert.ok(ids.includes(id), `${id} asistan arayüz alanı bulunmalı.`);
}
assert.match(
    html,
    /data-tab="assistant"/,
    'Asistan masaüstü navigasyonunda erişilebilir olmalı.'
);
assert.match(
    app,
    /sumIngredientAmounts\(currentTemplateItems\)\.combined/,
    'Boş tarif verimi malzeme miktarlarının toplamını kullanmalı.'
);

for (const id of [
    'dashboardDate',
    'dashboardPrevDate',
    'dashboardNextDate',
    'dashboardTodayDate',
    'summaryDateLabel',
    'summaryProgressDate'
]) {
    assert.ok(ids.includes(id), `${id} özet tarih kontrolü bulunmalı.`);
}
assert.match(
    app,
    /ai_usage:\s*\{[\s\S]*requests:\s*increment\(1\)/,
    'Asistan token kullanımı Firebase üzerinde biriktirilmeli.'
);

console.log('ui structure audit passed');
