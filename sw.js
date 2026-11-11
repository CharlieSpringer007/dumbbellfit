/*
 * DumbbellFit service worker: makes the app work with no connection.
 *
 * - On install, every file the app needs (the HTML page, exercise GIFs, coach
 *   audio, icons) is saved into the cache.
 * - Media and other static files are served cache-first.
 * - The HTML page is served from the cache straight away and refreshed in the
 *   background, so the app opens instantly offline and still picks up new
 *   versions the next time it is opened online.
 * - Audio is requested by Safari in byte ranges; those are answered from the
 *   cached file, otherwise coach clips would not play offline on iPhone.
 *
 * CACHE_VERSION and PRECACHE_URLS are generated from the files in this folder.
 * If you add or rename GIFs or audio clips, add them to the list and bump the version.
 */
const CACHE_VERSION = 'v2-d8132b9d45';
const CACHE_NAME = 'dumbbellfit-' + CACHE_VERSION;
const APP_SHELL = './dumbbell_workout_ios_app.html';

const PRECACHE_URLS = [
    "./dumbbell_workout_ios_app.html",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png",
    "./exercises_db.json",
    "./schedules_db.json",
    "./animations/bent_row.gif",
    "./animations/calf.gif",
    "./animations/calf_eccentric.gif",
    "./animations/eccentric_hammer.gif",
    "./animations/floor_press.gif",
    "./animations/glute_bridge.gif",
    "./animations/goblet_squat.gif",
    "./animations/hammer.gif",
    "./animations/iso_squat_hold.gif",
    "./animations/lunge.gif",
    "./animations/overhead_press.gif",
    "./animations/peloton_bike.gif",
    "./animations/peloton_climb.gif",
    "./animations/peloton_flush.gif",
    "./animations/peloton_intervals.gif",
    "./animations/peloton_sprint.gif",
    "./animations/peloton_tabata.gif",
    "./animations/rdl.gif",
    "./animations/russian_twist.gif",
    "./animations/scaption_raise.gif",
    "./audio/airplay_connected.m4a",
    "./audio/calf_eccentric_intro.m4a",
    "./audio/faster.m4a",
    "./audio/hammer_curl_intro.m4a",
    "./audio/iso_squat_intro.m4a",
    "./audio/lunge_intro.m4a",
    "./audio/minus_15.m4a",
    "./audio/overhead_intro.m4a",
    "./audio/paused.m4a",
    "./audio/peloton_intro.m4a",
    "./audio/plus_15.m4a",
    "./audio/press_intro.m4a",
    "./audio/rdl_intro.m4a",
    "./audio/rep_1.m4a",
    "./audio/rep_10.m4a",
    "./audio/rep_2.m4a",
    "./audio/rep_3.m4a",
    "./audio/rep_4.m4a",
    "./audio/rep_5.m4a",
    "./audio/rep_6.m4a",
    "./audio/rep_7.m4a",
    "./audio/rep_8.m4a",
    "./audio/rep_9.m4a",
    "./audio/rest_1.m4a",
    "./audio/rest_2.m4a",
    "./audio/rest_3.m4a",
    "./audio/rest_start.m4a",
    "./audio/resumed.m4a",
    "./audio/row_intro.m4a",
    "./audio/scaption_intro.m4a",
    "./audio/slower.m4a",
    "./audio/squat_intro.m4a",
    "./audio/tendon_intro.m4a"
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Add files one by one so a single missing file cannot block the install.
        await Promise.all(PRECACHE_URLS.map(async (url) => {
            try {
                const response = await fetch(new Request(url, { cache: 'reload' }));
                if (response.ok) await cache.put(url, response);
            } catch (err) {
                // Offline or missing: it will be cached on first use instead.
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith('dumbbellfit-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

// The page asks how much of the app is saved, to show "offline ready".
self.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'CACHE_STATUS' || !event.ports || !event.ports[0]) return;
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedPaths = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
        const cached = PRECACHE_URLS.filter((url) => cachedPaths.has(new URL(url, self.registration.scope).pathname)).length;
        event.ports[0].postMessage({ version: CACHE_VERSION, cached, total: PRECACHE_URLS.length });
    })());
});

async function fetchAndCache(request) {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
    }
    return response;
}

async function cacheFirst(request) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return fetchAndCache(request);
}

async function appShell(event) {
    const cached = await caches.match(event.request, { ignoreSearch: true }) || await caches.match(APP_SHELL);
    const refresh = fetchAndCache(new Request(event.request.url, { cache: 'no-cache' })).catch(() => null);
    if (cached) {
        event.waitUntil(refresh);
        return cached;
    }
    const fresh = await refresh;
    if (fresh) return fresh;
    return new Response('DumbbellFit is offline and has not been saved on this device yet. Open it once with a connection.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// Answer "Range: bytes=a-b" requests (audio on Safari) from the complete cached file.
async function rangeFromCache(request) {
    const fullRequest = new Request(request.url);
    let response = await caches.match(fullRequest, { ignoreSearch: true });
    if (!response) response = await fetchAndCache(fullRequest);
    if (!response || response.status !== 200) return response;

    const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    if (!match) return response;

    const buffer = await response.arrayBuffer();
    const size = buffer.byteLength;
    let start;
    let end;
    if (match[1] === '') {
        // "bytes=-N": the last N bytes
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }

    if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    return new Response(buffer.slice(start, end + 1), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
        }
    });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.headers.has('range')) {
        event.respondWith(rangeFromCache(request).catch(() => fetch(request)));
        return;
    }

    if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
        event.respondWith(appShell(event));
        return;
    }

    event.respondWith(cacheFirst(request).catch(() => new Response('', { status: 504 })));
});
