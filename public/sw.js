/* tokoku — service worker MINIMAL (tanpa cache sama sekali).
   Tugasnya hanya memenuhi syarat install PWA ("Tambahkan ke Layar utama"):
   - install langsung aktif (skipWaiting),
   - activate menghapus semua cache lama bila ada,
   - fetch TIDAK dicegat (tanpa respondWith) supaya semua permintaan
     tetap ke jaringan dan update aplikasi tidak pernah basi karena cache.
   JANGAN tambahkan caching di sini tanpa persetujuan — data toko harus
   selalu yang terbaru dari server. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function () {
  // Sengaja kosong: biarkan browser mengambil langsung dari jaringan.
});
