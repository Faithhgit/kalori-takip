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

assert.match(
    app,
    /where\('date',\s*'==',\s*date\)/,
    'Weight deletion should remove every cloud copy for the selected date.'
);
const applyTemplateSource = app.slice(
    app.indexOf('async function applyTemplate'),
    app.indexOf('async function deleteTemplate')
);
assert.doesNotMatch(
    applyTemplateSource,
    /switchTab\('logs'\)/,
    'Adding a saved meal should not force navigation to the diary.'
);
assert.ok(
    [...app.matchAll(/showLogAddedNotification\(/g)].length >= 5,
    'All diary add flows should use the shared success notification.'
);
assert.match(css, /\.toast-action\s*\{/, 'The success notification should provide a diary shortcut.');
assert.match(html, /styles\.css\?v=60/, 'The current stylesheet version should bypass stale app caches.');
assert.match(html, /router\.js\?v=60/, 'The current router version should bypass stale app caches.');
assert.match(html, /app\.js\?v=60/, 'The current application version should bypass stale app caches.');
assert.match(html, /class="notification-stack"/, 'Recent notifications should render in a shared stack.');
assert.match(css, /\.app-toast:nth-child\(3\)/, 'The notification stack should visually retain three items.');
assert.match(css, /\.meal-log-grid\s*\{/, 'Diary entries should use the responsive meal card grid.');
assert.match(css, /\.add-step-heading\s*\{/, 'The food add flow should expose clear visual steps.');
assert.match(css, /\.dashboard-date-nav \.dashboard-today-btn\[hidden\]/, 'The iPhone date controls should respect the hidden today action.');
for (const token of [
    '--ui-font-meta',
    '--ui-font-body',
    '--ui-font-card',
    '--ui-radius-control',
    '--ui-radius-card',
    '--ui-control-height'
]) {
    assert.ok(css.includes(token), `${token} shared design token should exist.`);
}
assert.match(
    css,
    /body:not\(\[data-page="dashboard"\]\) \.main-content\s*\{[\s\S]*?background:\s*transparent;/,
    'Non-dashboard pages should not add a second visual shell around their primary cards.'
);
assert.match(
    css,
    /\.meal-log-grid > \.log-item:only-child/,
    'A single diary item should fill its meal row instead of leaving a blank column.'
);
assert.match(
    css,
    /body > \.tabs-container\.is-mobile-docked[\s\S]*?position:\s*fixed\s*!important/,
    'Mobile navigation should be docked directly to the viewport.'
);
assert.match(
    css,
    /\.calorie-ring-inner > \*[\s\S]*?z-index:\s*2/,
    'Energy ring copy should stay above decorative ring layers.'
);
assert.doesNotMatch(
    app,
    /controllerchange[\s\S]{0,240}location\.reload/,
    'Service worker updates should not reload the page during navigation.'
);
for (const id of [
    'brandHome',
    'applyDailyTargets',
    'quickYesterdayBtn',
    'logsRangePicker',
    'logsRangeLabel',
    'applyLogsDateRange'
]) {
    assert.ok(ids.includes(id), `${id} updated interaction should exist.`);
}
assert.match(
    app,
    /saveSettingsToCloud\(calculatedTargets,\s*profile,\s*macroPreferences\)/,
    'Calculated profile goals should be persisted immediately.'
);
assert.match(
    css,
    /body\[data-page="progress"\] \.weekly-chart\s*\{[\s\S]*?min-width:\s*0/,
    'The weekly chart should fit the mobile card without horizontal scrolling.'
);
assert.match(
    app,
    /const compactChart = window\.matchMedia\('\(max-width: 760px\)'\)\.matches/,
    'The weekly chart should render at a readable mobile-native scale.'
);
assert.match(
    css,
    /\.calorie-ring\.is-over/,
    'Daily energy should expose an over-target warning state.'
);

console.log('ui structure audit passed');
