import assert from 'node:assert/strict';
import assistant, { getModelRoute } from './assistant.js';

assert.deepEqual(
    getModelRoute('suggest', false, { primaryModel: '', searchModel: '' }),
    ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
);
assert.deepEqual(
    getModelRoute('review', false, { primaryModel: 'gemini-custom', searchModel: '' }),
    ['gemini-custom', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
);
assert.deepEqual(
    getModelRoute('add', true, { primaryModel: '', searchModel: 'gemini-search' }),
    ['gemini-search', 'gemini-3.6-flash']
);

const call = (method, body, headers = {}) => assistant.fetch(new Request(
    'http://localhost:3000/api/assistant',
    {
        method,
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }
));

const optionsResponse = await call('OPTIONS');
assert.equal(optionsResponse.status, 204);

const methodResponse = await call('GET');
assert.equal(methodResponse.status, 405);

const emptyResponse = await call('POST', { mode: 'add', message: '' });
assert.equal(emptyResponse.status, 400);

const missingContextResponse = await call('POST', { mode: 'review' });
assert.equal(missingContextResponse.status, 400);

const previousKey = process.env.GEMINI_API_KEY;
const previousConsoleError = console.error;
console.error = () => {};
delete process.env.GEMINI_API_KEY;
const missingKeyResponse = await call('POST', {
    mode: 'review',
    today: '2026-07-27',
    context: [1, [], [], [], []]
});
assert.equal(missingKeyResponse.status, 503);
assert.match((await missingKeyResponse.json()).error, /Vercel/);
if (previousKey) process.env.GEMINI_API_KEY = previousKey;
console.error = previousConsoleError;

console.log('assistant api tests passed');
