# Cara memindahkan perubahan dari versi Muse ke versi publik

Alur kerja yang disepakati dengan Andrik (2026-11-06): **setiap pembaruan
dibuat dulu di versi Muse** (artifact slug `toko-klontong`, diperbaiki lewat
`artifact.edit`/`artifact.inspect`), **lalu dipindahkan ke versi publik** di
folder ini. Tujuannya: pembaruan berikutnya tidak dibangun ulang dari nol.

## Prinsip susunan kode (supaya porting mudah)

- **Satu server, tanpa dependensi eksternal.** `server.js` hanya memakai
  modul bawaan Node (`http`, `node:sqlite`). Tidak ada `npm install` yang
  bisa gagal saat deploy; update Node tetap jalan.
- **Dua aplikasi terpisah, satu server + satu database (sejak 2026-11-07).**
  `public/warga.html` + `public/warga.js` (aplikasi Warga, rute `/`),
  `public/admin.html` + `public/admin.js` (aplikasi Admin, rute `/admin`),
  `public/common.js` (kode bersama: API, toast, modal, muat settings/produk,
  kirim chat). Tidak ada framework/build step, tidak ada mode-switch.
  Perubahan tampilan/teks warga ubah di `warga.*`; admin di `admin.*`;
  yang dipakai keduanya di `common.js` / `style.css`.
- **Penanda fitur.** Setiap blok fitur di `server.js` dan `public/common.js`,
  `public/warga.js`, `public/admin.js` diawali komentar `// FITUR: ...`.
  Saat memindahkan perubahan, cari penanda yang sama di file-file itu dan
  ubah blok itu saja.
- **Kontrak API tetap.** Frontend hanya memanggil endpoint `/api/...` yang
  didokumentasikan di `README.md`. Perubahan perilaku server harus menjaga
  bentuk respons yang sama, atau ubah frontend di tempat yang sama.
- **Data tidak ikut pindah.** Yang dipindahkan hanya kode/perilaku. Data
  (barang, warga, pesanan, saldo) di versi publik tetap milik versi publik
  dan tidak ditimpa oleh porting.

## Langkah porting perubahan (checklist)

1. **Catat perubahan di versi Muse.** Setelah perbaikan di versi Muse
   selesai dan terverifikasi, tulis apa yang berubah: fitur, layar yang
   terkena, aturan baru (mis. harga, batas, status), dan nilai bawaan
   (mis. ongkir Rp2.000, saklar mati).
2. **Cari penanda fitur di versi publik.** Buka `FITUR.md`, temukan baris
   fitur yang bersangkutan, lalu cari komentar `// FITUR: ...` yang sama
   di `server.js` dan/atau `public/common.js`, `public/warga.js`,
   `public/admin.js`.
3. **Ubah di tempat yang sama.**
   - Perubahan aturan/data (harga, ongkir, status pesanan, validasi):
     ubah di `server.js` dulu — server yang menegakkan aturan.
   - Perubahan tampilan/teks: ubah di `public/warga.html` / `public/admin.html` / `public/style.css`.
   - Perubahan alur di layar (tombol, form, navigasi): ubah di `public/warga.js` (warga),
     `public/admin.js` (admin), atau `public/common.js` (dipakai keduanya).
   - Perubahan struktur data: tambah kolom/tabel di fungsi init database
     `server.js` dengan migrasi "tambah bila belum ada" (jangan hapus
     tabel — data warga yang sudah ada harus selamat).
4. **Perbarui `FITUR.md`.** Tambah/ubah baris fitur dan, bila perlu,
   bagian "Batasan yang diketahui".
5. **Uji lokal sebelum deploy.** Jalankan `node server.js`, lalu uji lewat
   `http://localhost:3000` alur yang berubah (lihat README.md "Uji lokal").
   Periksa juga di lebar HP: bilah keranjang tidak tertutup menu bawah,
   teks header tidak terpotong.
6. **Deploy ulang.** Push ke repo GitHub → layanan hosting men-deploy
   otomatis (Render/Railway). Cek URL publik setelah deploy selesai.

## Pemetaan fitur → file

| Perubahan | File yang diubah |
|---|---|
| Aturan harga/ongkir/status/validasi | `server.js` (blok `// FITUR: ...`) |
| Teks, label, placeholder, warna, ukuran font | `public/warga.html`, `public/admin.html`, `public/style.css` |
| Alur layar, tombol, form, navigasi (warga) | `public/warga.js` (blok `// FITUR: ...`) |
| Alur layar, tombol, form, navigasi (admin) | `public/admin.js` (blok `// FITUR: ...`) |
| Alur layar, tombol, form, navigasi (bersama) | `public/common.js` (blok `// FITUR: ...`) |
| Layar loading awal (splash hijau + logo + titik berputar) | `public/warga.html`, `public/admin.html` (elemen `#splash` + pengaman 15 detik), `public/style.css` (`.splash`, `.splash-orbit`), `public/common.js` (`hideSplash()`), `public/warga.js` / `public/admin.js` (panggil di akhir `render()`) |
| Live update tanpa refresh (polling 10 detik, hanya bila berubah) | `public/warga.js` / `public/admin.js` (`startLivePoll()` / `pollLive()` + snapshot `lastLive`), `public/common.js` (`preserveScroll()`, `viewHasFormFocus()`, `chatBubblesHtml()`) |
| Snapshot gambar di data pesanan | `server.js` (tambah `image` di tiap item saat `POST /api/orders`), `public/common.js` (`orderItemsHtml()`), `public/warga.js` / `public/admin.js` (pakai `orderItemsHtml()` di kartu pesanan) |
| Detail produk (klik gambar) | `public/warga.js` (`openProductDetail()` / `renderProductDetail()` / `detailAddToCart()`), `public/style.css` (`.product-detail-*`, `.detail-qty-row`) |
| Kolom/tabel baru | `server.js` (init database + migrasi) |
| Endpoint baru | `server.js` + pemanggilnya di `public/common.js` / `public/warga.js` / `public/admin.js` |
| Aset baru (logo, QRIS, foto) | `public/` + referensi di `public/warga.html` / `public/admin.html` |

- **Pola live update (sejak 2026-11-07 malam).** Polling 10 detik di
  `warga.js`/`admin.js` membandingkan `JSON.stringify` data baru dengan
  snapshot `lastLive` dan hanya membangun ulang tampilan bila berubah;
  `preserveScroll()` menjaga posisi scroll, `viewHasFormFocus()` menahan
  pembangunan ulang saat formulir sedang diisi, dan chat hanya mengganti
  isi `#chatBox` (bukan seluruh tampilan) supaya teks ketikan tidak hilang.
  Jangan kembalikan interval chat per-tab yang membangun ulang seluruh
  tampilan — itu yang dulu menghapus teks ketikan.
- **Pola snapshot (sejak 2026-11-07 malam).** Data yang harus bertahan
  walau sumbernya berubah/dihapus (mis. foto barang di pesanan) disimpan
  sebagai snapshot di JSON pesanan saat dibuat (`server.js`), bukan dibaca
  ulang dari katalog. Tidak perlu ubah skema DB selama field-nya sudah
  berupa JSON string; pesanan lama tanpa field itu tetap bisa dibaca
  (tampil tanpa gambar).
- **Pola splash (sejak 2026-11-07 malam).** Elemen `#splash` ditulis
  langsung di HTML sebelum `<script>` agar tampil sebelum JS jalan;
  disembunyikan di akhir `render()` pertama (`hideSplash()`), dengan
  pengaman `setTimeout` 15 detik di HTML bila JS gagal.

## Yang belum ada (ide untuk pembaruan berikutnya)

- PIN/kata sandi untuk mode Admin (saat ini saklar mode tanpa kata sandi).
- Pencarian barang di katalog warga.
- Notifikasi di luar aplikasi (mis. WhatsApp) saat pesanan/top-up masuk.
- Ekspor laporan (pesanan/penjualan) ke spreadsheet.
