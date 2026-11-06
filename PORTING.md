# Cara memindahkan perubahan dari versi Muse ke versi publik

Alur kerja yang disepakati dengan Andrik (2026-11-06): **setiap pembaruan
dibuat dulu di versi Muse** (artifact slug `toko-klontong`, diperbaiki lewat
`artifact.edit`/`artifact.inspect`), **lalu dipindahkan ke versi publik** di
folder ini. Tujuannya: pembaruan berikutnya tidak dibangun ulang dari nol.

## Prinsip susunan kode (supaya porting mudah)

- **Satu server, tanpa dependensi eksternal.** `server.js` hanya memakai
  modul bawaan Node (`http`, `node:sqlite`). Tidak ada `npm install` yang
  bisa gagal saat deploy; update Node tetap jalan.
- **Satu halaman frontend.** `public/index.html` (struktur), `public/style.css`
  (tampilan), `public/app.js` (logika). Tidak ada framework/build step.
- **Penanda fitur.** Setiap blok fitur di `server.js` dan `public/app.js`
  diawali komentar `// FITUR: <nama fitur>`. Saat memindahkan perubahan,
  cari penanda yang sama di kedua versi dan ubah blok itu saja.
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
   di `server.js` dan/atau `public/app.js`.
3. **Ubah di tempat yang sama.**
   - Perubahan aturan/data (harga, ongkir, status pesanan, validasi):
     ubah di `server.js` dulu — server yang menegakkan aturan.
   - Perubahan tampilan/teks: ubah di `public/index.html` / `public/style.css`.
   - Perubahan alur di layar (tombol, form, navigasi): ubah di `public/app.js`.
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
| Teks, label, placeholder, warna, ukuran font | `public/index.html`, `public/style.css` |
| Alur layar, tombol, form, navigasi | `public/app.js` (blok `// FITUR: ...`) |
| Kolom/tabel baru | `server.js` (init database + migrasi) |
| Endpoint baru | `server.js` + pemanggilnya di `public/app.js` |
| Aset baru (logo, QRIS, foto) | `public/` + referensi di `public/index.html` |

## Yang belum ada (ide untuk pembaruan berikutnya)

- PIN/kata sandi untuk mode Admin (saat ini saklar mode tanpa kata sandi).
- Pencarian barang di katalog warga.
- Notifikasi di luar aplikasi (mis. WhatsApp) saat pesanan/top-up masuk.
- Ekspor laporan (pesanan/penjualan) ke spreadsheet.
