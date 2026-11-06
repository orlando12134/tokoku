# Daftar fitur versi publik tokoku

Versi publik ini adalah pembangunan ulang aplikasi toko klontong "tokoku"
milik Andrik (khusus warga Perum GKR) agar bisa dibuka lewat tautan publik
dengan database bersama. Versi Muse (artifact slug `toko-klontong`) tetap
menjadi tempat pertama setiap pembaruan dibuat; versi ini mengikutinya
(lihat PORTING.md). Data awal kosong — Andrik mengisi barang dan warga
asli sendiri.

## Struktur kode

| Bagian | File |
|---|---|
| Server + API + database SQLite | `server.js` |
| Halaman aplikasi (satu halaman) | `public/index.html` |
| Tampilan (mobile-first) | `public/style.css` |
| Logika aplikasi (mode Admin/Warga) | `public/app.js` |
| Logo toko | `public/logo.png` |
| Gambar QRIS | `public/qris.jpg` |
| Database (dibuat saat server pertama jalan) | `data/tokoku.db` |

## Fitur

### Header dan tampilan
- [x] Logo keranjang hijau TOKOKU di header (Admin dan Warga).
- [x] Tulisan "Warga Perum GKR saja" di bawah logo: besar, tebal, warna emas.
- [x] Tampilan HP: bilah keranjang dan barang terakhir tidak tertutup menu bawah/gesture bar (padding memperhitungkan safe-area); teks header tidak terpotong.

### Warga — akun
- [x] Daftar: nama, nomor HP, blok (contoh "mawar"), nomor rumah (contoh "AA01").
- [x] Verifikasi admin sebelum bisa belanja; penolakan menampilkan alasan admin.
- [x] 1 nomor HP = 1 akun (nomor yang sudah terdaftar menampilkan "Masuk sebagai ...", tidak membuat akun kedua).
- [x] Log in pakai nomor HP; log out di tab Akun.

### Admin — barang
- [x] +Barang: nama, harga, stok, kategori, upload foto (pratinjau), kolom "Harga spesial bayar pakai saldo".
- [x] Ubah harga/stok/kategori dan sembunyikan barang; foto tampil di daftar admin, katalog warga, dan keranjang.

### Saldo dan top-up
- [x] Top-up via QRIS (gambar atas nama Toko Khayla, NMID ID1022215364889, A01), transfer, atau tunai; admin menyetujui.
- [x] Halaman saldo menampilkan jelas "Saldo tokoku tidak dapat diuangkan kembali".
- [x] Tidak bisa mengajukan top-up baru sebelum pengajuan lama disetujui (form diganti pemberitahuan; server juga menolak).
- [x] Penolakan top-up memakai kotak alasan; alasan tampil ke warga.

### Pesanan
- [x] Diantar ke rumah (ongkir Rp2.000, bisa diubah admin; gratis kalau ambil di toko) atau ambil di toko.
- [x] Wajib pilih jam: 09.00-10.00, 11.00-12.00, 16.00-17.00, 19.00-20.00; jam tampil di kartu pesanan.
- [x] Bayar pakai saldo (memakai harga spesial bila ada) atau tunai (catatan "Mohon bayar dengan uang pas" di menu bayar dan kartu pesanan).
- [x] Catatan untuk toko, contoh "cth. Tolong di taruh di kranjang paket".
- [x] Saklar on/off "Gratis ongkir bila bayar pakai saldo" di pengaturan admin (bawaan mati); keranjang menampilkan "GRATIS (bayar pakai saldo)" bila aktif.
- [x] Warga bisa membatalkan pesanan Baru (stok dan saldo dikembalikan); tidak bisa membatalkan bila sudah Diproses (server juga menolak).
- [x] Admin memproses Baru → Diproses → Selesai; cari pesanan berdasarkan tanggal dan jam; cetak struk per pesanan.
- [x] Admin melihat riwayat transaksi tiap warga terverifikasi (pesanan, top-up, total belanja).

### Chat
- [x] Chat Admin–Warga: kirim teks dan gambar (lampirkan, pratinjau, tampil di gelembung).
- [x] Lencana jumlah pesan belum dibaca di kedua sisi; tertandai terbaca saat percakapan dibuka.

### Toko buka/tutup
- [x] Saklar di Beranda Admin (bawaan buka); saat tutup, warga tidak bisa melihat etalase dan tidak bisa memesan (server menolak pesanan baru).

## Batasan yang diketahui
- Mode Admin/Warga diganti lewat saklar di header tanpa kata sandi — sama seperti
  versi Muse. Untuk pemakaian serius jangka panjang, tambahkan PIN/kata sandi admin
  (lihat PORTING.md, "Yang belum ada").
- Server ini satu proses dengan SQLite lokal; cocok untuk skala komplek (10–20 warga).
