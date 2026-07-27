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

console.log('ui structure audit passed');
