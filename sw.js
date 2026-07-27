const CACHE_NAME = 'denge-v55';
const FIREBASE_SDK_ORIGIN = 'https://www.gstatic.com';
const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './router.js',
    './app.js',
    './ai-config.js',
    './firebase-config.js',
    './lib/ai.js',
    './lib/ai-context.js',
    './lib/ai-usage.js',
    './lib/demo-data.js',
    './lib/nutrition.js',
    './lib/portion.js',
    './lib/planning.js',
    './lib/insights.js',
    './lib/schema.js',
    './lib/firestore-store.js',
    './lib/progress-media.js',
    './lib/profile.js',
    './lib/search.js',
    './lib/ui-components.js',
    './data/foods.js',
    './data/drinks.js',
    './manifest.webmanifest',
    './icon.svg',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin && url.origin !== FIREBASE_SDK_ORIGIN) return;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(async response => {
                    if (response.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(event.request, response.clone());
                    }
                    return response;
                })
                .catch(async () =>
                    (await caches.match(event.request))
                    || (await caches.match('./index.html'))
                    || Response.error()
                )
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkRequest = fetch(event.request)
                .then(async response => {
                    if (response.ok) {
                        const copy = response.clone();
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(event.request, copy);
                    }
                    return response;
                });

            if (cached) {
                event.waitUntil(networkRequest.catch(() => undefined));
                return cached;
            }

            return networkRequest.catch(async () => {
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return Response.error();
            });
        })
    );
});
