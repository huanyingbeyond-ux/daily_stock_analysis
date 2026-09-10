/* ============================================================
 * DSA Mobile - sw.js
 * Service Worker：缓存应用外壳，离线可用；行情数据永不缓存。
 * ============================================================ */
var CACHE = 'dsa-shell-v103';
var SHELL = [
    './',
    './index.html',
    './css/app.css?v=103',
    './js/util.js?v=103',
    './js/store.js?v=103',
    './js/quote.js?v=103',
    './js/chart.js?v=103',
    './js/llm.js?v=103',
    './js/analyzer.js?v=103',
    './js/server.js?v=103',
    './js/market.js?v=103',
    './js/chat.js?v=103',
    './js/app.js?v=103',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                .map(function (k) { return caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);

    // 跨域（行情/搜索/大模型 API）：完全绕过 SW，保证数据实时
    if (url.origin !== location.origin) return;

    // 导航请求：网络优先，失败回落缓存（离线打开）
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req).then(function (res) {
                var copy = res.clone();
                caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
                return res;
            }).catch(function () { return caches.match('./index.html'); })
        );
        return;
    }

    // 静态资源：缓存优先，后台更新
    e.respondWith(
        caches.match(req).then(function (hit) {
            var fetching = fetch(req).then(function (res) {
                if (res && res.status === 200) {
                    var copy = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, copy); });
                }
                return res;
            }).catch(function () { return hit; });
            return hit || fetching;
        })
    );
});
