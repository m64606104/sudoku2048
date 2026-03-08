/**
 * sw.js - Service Worker for PWA
 * 缓存核心文件实现离线访问
 */

const CACHE_NAME = 'vision-soul-v1';
const ASSETS = [
  '/index.html',
  '/style.css',
  '/store.js',
  '/vision.js',
  '/api.js',
  '/ui.js',
  '/manifest.json'
];

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', (event) => {
  // 跳过 API 请求（不缓存）
  if (event.request.url.includes('/v1/') || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // 缓存新的请求
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      // 离线回退
      if (event.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});
