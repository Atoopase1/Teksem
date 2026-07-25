const CACHE_NAME = 'energy-monitor-v6'; // Bumped to force SW update on all clients
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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.log('SW Cache error:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co')) return;
  if (event.request.url.includes('cdn.jsdelivr.net')) return;
  if (event.request.url.includes('emqx.io')) return;
  if (event.request.url.includes('broker.')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => response)
      .catch(() => caches.match(event.request))
  );
});

// ============================================
// FAULT ALERT — postMessage from main app
// ============================================
// The main app calls:
//   registration.active.postMessage({ type: 'FAULT_ALERT', title, body, tag })
// The SW fires a persistent device notification visible even in background / lock screen.
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'FAULT_ALERT') return;

  const title = event.data.title || '⚡ SEMHAS FAULT ALARM';
  const body  = event.data.body  || 'Critical fault detected! Check your system immediately.';
  const tag   = event.data.tag   || 'semhas-fault';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:               '/icon-192.png',
      badge:              '/icon-192.png',
      tag,
      renotify:           true,           // Re-rings even if notification is already showing
      requireInteraction: true,           // Stays on screen until user taps (doesn't auto-dismiss)
      vibrate:            [400, 100, 400, 100, 600, 100, 400, 100, 400], // Urgent double-burst
      silent:             false,
      actions: [
        { action: 'open',    title: '📋 Open SEMHAS' },
        { action: 'dismiss', title: '✖ Dismiss' }
      ]
    })
  );
});

// ============================================
// NOTIFICATION CLICK → Open / Focus App
// ============================================
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ============================================
// PUSH EVENT (for future VAPID server-push)
// ============================================
self.addEventListener('push', event => {
  let data = {
    title: '⚡ SEMHAS Fault Alarm',
    body:  'A fault has been detected! Open the app immediately.',
    icon:  '/icon-192.png'
  };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:               data.body,
      icon:               data.icon || '/icon-192.png',
      badge:              '/icon-192.png',
      vibrate:            [400, 100, 400, 100, 600],
      tag:                'semhas-push-alert',
      renotify:           true,
      requireInteraction: true
    })
  );
});
