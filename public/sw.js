const CACHE_NAME = 'energy-monitor-v5';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/supabase.js',
  '/js/charts.js',
  '/js/alerts.js',
  '/js/demo.js',
  '/js/app.js',
  '/app-icon.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force new SW to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.log('Cache error: ', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim()); // Take control of all pages immediately

  // Delete old caches so users don't get stuck on broken/old versions
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // For API calls (like Supabase), bypass cache completely
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  // Also bypass cache for CDN scripts (always fetch latest)
  if (event.request.url.includes('cdn.jsdelivr.net')) {
    return;
  }

  // Network First Strategy: Try downloading from network first.
  // If offline, fallback to cache.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Optional: you can dynamically cache new things here if you want
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// ============================================
// NOTIFICATION CLICK → Open / Focus App
// ============================================
// When the user taps a notification on their phone, this opens the app
// (or focuses it if it is already open in the background).
self.addEventListener('notificationclick', event => {
  event.notification.close(); // Dismiss the notification

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If the app is already open in a tab/window, focus it
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ============================================
// PUSH EVENT (for future VAPID push server)
// ============================================
// This runs when a push message arrives from a server even when the app is closed.
// Currently handled via postMessage from main.js for background-aware notifications.
self.addEventListener('push', event => {
  let data = { title: '⚡ Energy Alert', body: 'A fault has been detected!', icon: '/icon-192.png' };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200, 100, 400],
      tag: 'energy-alert',        // Replace previous notification of same type
      renotify: true,
      requireInteraction: true    // Stay on screen until user taps
    })
  );
});
