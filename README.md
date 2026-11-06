# tokoku — versi publik (di luar Muse)

Aplikasi web toko klontong "tokoku" khusus warga Perum GKR, dibangun ulang
agar bisa dibuka lewat tautan publik dengan database bersama. Satu server
Node.js tanpa dependensi eksternal melayani frontend dan API; data di SQLite.

Versi Muse (artifact slug `toko-klontong`) tetap menjadi tempat pertama
setiap pembaruan dibuat — lihat `PORTING.md` untuk cara memindahkannya ke sini.
Daftar fitur ada di `FITUR.md`.

## Menjalankan lokal

Butuh Node.js 22 atau lebih baru (memakai `node:sqlite` bawaan).

```bash
cd toko-klontong-publik
node server.js
# buka http://localhost:3000
```

Database dibuat otomatis di `data/tokoku.db` (kosong saat pertama jalan).
Variabel lingkungan: `PORT` (default 3000), `DB_PATH` (default
`data/tokoku.db` — isi dengan path disk persisten saat deploy).

## Deploy ke URL publik

**Status: belum ter-deploy.** Tidak ada jalur deploy yang bisa dieksekusi
dari lingkungan ini tanpa akun Andrik — VM ini tidak bisa dijangkau publik,
dan tidak ada akun hosting yang sudah terhubung. Kode di bawah ini sudah
siap deploy; yang dibutuhkan dari Andrik tercantum di bawah.

### Jalur yang disarankan: Render (paling sederhana)

1. Buat akun **GitHub** (gratis) dan akun **Render** (gratis, bisa daftar
   memakai akun GitHub).
2. Push folder ini ke repo GitHub (mis. nama repo `tokoku`).
3. Di dashboard Render: **New → Web Service** → hubungkan repo GitHub.
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: `Free` untuk coba-coba (lihat peringatan data di bawah).
4. URL publik menjadi `https://tokoku.onrender.com` (nama bisa dipilih
   saat pembuatan service; angka acak ditambahkan Render bila nama sudah
   dipakai).

**Peringatan data — baca sebelum memakai serius:**
- Paket **Free Render memakai filesystem ephemeral**: database SQLite
  hilang setiap deploy/restart. Cocok untuk uji coba, TIDAK untuk
  pemakaian serius.
- Supaya data bertahan, perlu paket **Starter (berbayar, sekitar
  $7/bulan)** + **Persistent Disk** (mount path mis. `/var/data`, lalu
  set env `DB_PATH=/var/data/tokoku.db`), atau pakai PostgreSQL
  terkelola Render.
- Paket Free juga "tidur" setelah 15 menit tanpa kunjungan; kunjungan
  pertama setelah itu lambat (±30–60 detik) sampai server bangun.

### Alternatif: Railway

Serupa dengan Render (Web Service dari repo GitHub, `node server.js`),
dengan volume persisten. Paket gratis berupa kredit percobaan, setelah
itu berbayar sesuai pemakaian. Cocok bila Andrik lebih nyaman dengan
Railway daripada Render.

### Tidak disarankan: Vercel/Netlify untuk arsitektur ini

Keduanya serverless — SQLite lokal tidak bertahan antar request, jadi
perlu database eksternal (mis. Supabase Postgres gratis) dan penulisan
ulang lapisan database. Hanya dipilih bila Andrik memang mau jalur itu.

## Uji lokal (ringkasan hasil 2026-11-06)

Diuji end-to-end lewat HTTP terhadap server lokal (database uji terpisah,
sudah dihapus; database produksi tetap kosong):
- Daftar warga → verifikasi admin; daftar ulang nomor sama → akun lama,
  tanpa akun ganda; log in nomor tak dikenal → tidak ditemukan.
- Top-up Rp100.000 → disetujui → saldo Rp100.000; top-up kedua saat
  masih pending ditolak.
- Pesanan saldo 1× Beras (harga spesial Rp55.000) + antar: total
  Rp57.000 (ongkir Rp2.000), saldo tersisa Rp43.000.
- Pesanan tunai ambil dibatalkan saat Baru → status dibatalkan; batal
  saat Diproses ditolak.
- Gratis ongkir saldo menyala → pesanan saldo antar ongkir Rp0;
  pesanan tunai tetap kena ongkir.
- Toko ditutup → pesanan ditolak; dibuka lagi normal.
- Chat teks + gambar terkirim; lencana belum dibaca 2 → 0 setelah
  dibaca admin.
- Struk pesanan tunai memuat "Mohon bayar dengan uang pas".
- Cari pesanan berdasarkan tanggal dan jam berfungsi; riwayat warga
  menampilkan pesanan, top-up, dan total belanja.
- Penolakan warga dengan alasan tersimpan dan tampil saat log in.
- Halaman utama, `app.js`, logo, dan QRIS terlayani (HTTP 200);
  tidak ada URL eksternal/CDN di frontend.

Yang belum diuji: tampilan di browser HP sungguhan (hanya diperiksa
lewat kode CSS safe-area dan pengujian HTTP). Minta Andrik mencoba di
HP-nya sebelum mengumumkan ke warga — sesuai skill `app_creation_phone_check`.

## Struktur

```
server.js            Server + API + SQLite (tanpa dependensi)
public/index.html    Halaman aplikasi (Admin + Warga)
public/style.css     Tampilan mobile-first
public/app.js        Logika aplikasi
public/logo.png      Logo keranjang hijau TOKOKU
public/qris.jpg      Kode QRIS (Toko Khayla)
data/tokoku.db       Database (dibuat otomatis; kosong di awal)
FITUR.md             Daftar fitur versi publik
PORTING.md           Cara memindahkan perubahan dari versi Muse
render.yaml          Blueprint Render (lihat peringatan data di atas)
```
