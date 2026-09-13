
# Foto Pos Hujan Kerjasama

Taruh foto tiap pos di sini dengan nama file **sama persis dengan `id_pos`**,
contoh:

```
assets/foto_pos/PH001.jpg
assets/foto_pos/PH004.jpg
```

Cek `id_pos` masing-masing pos di sheet `lokasi_PosKerjasama` / `lokasi_BMKG`
pada DataBase, atau lihat di `output/latest.json` (field `id_pos`).

Catatan:
- Format default yang dibaca app.js adalah **.jpg** (bisa diganti ke .png/.webp
  lewat konstanta `FOTO_POS_EXT` di `app.js`).
- Kompres/resize dulu sebelum upload -- disarankan lebar ~800px & ukuran
  file di bawah ~300KB per foto, supaya repo & situs tetap ringan.
- Kalau foto untuk suatu pos belum ada, popup di peta otomatis menampilkan
  avatar warna + inisial nama pos sebagai gantinya -- jadi tidak wajib
  lengkap semua sekaligus, bisa diisi bertahap.
