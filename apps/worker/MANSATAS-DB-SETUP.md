# Aktivasi sumber peserta `mansatas-db`

Database dan schema yang sudah dikonfirmasi:

- database: `mansatas-db`
- database ID: `76b7b346-3f3f-4c1e-a347-2d51497bad97`
- tabel peserta: `siswa`
- tabel kelas: `kelas`
- relasi kelas: `siswa.kelas_id` → `kelas.id`
- status aktif: `siswa.status = 'aktif'`

Kode CBT memiliki adapter `mansatas` yang memakai binding dan mapping eksplisit berikut. Database sekolah tetap read-only dari sisi CBT.

## Mapping aktif

Mapping yang dipakai Worker:

```toml
MANSATAS_DB_TABLE = "siswa"
MANSATAS_DB_ID_COLUMN = "id"
MANSATAS_DB_NISN_COLUMN = "nisn"
MANSATAS_DB_NAME_COLUMN = "nama_lengkap"
MANSATAS_DB_GENDER_COLUMN = "jenis_kelamin"
MANSATAS_DB_ACTIVE_COLUMN = "status"
MANSATAS_DB_ACTIVE_VALUE = "aktif"

MANSATAS_DB_CLASS_TABLE = "kelas"
MANSATAS_DB_CLASS_ID_COLUMN = "id"
MANSATAS_DB_CLASS_FOREIGN_KEY_COLUMN = "kelas_id"
MANSATAS_DB_CLASS_GRADE_COLUMN = "tingkat"
MANSATAS_DB_CLASS_NUMBER_COLUMN = "nomor_kelas"
MANSATAS_DB_CLASS_GROUP_COLUMN = "kelompok"
```

`class_name` dinormalisasi sebagai gabungan `tingkat`, `kelompok`, dan
`nomor_kelas`, misalnya `10 UMUM 1`. Database sekolah hanya dibaca; CBT
tidak melakukan INSERT, UPDATE, atau DELETE ke database tersebut.

## Verifikasi schema berikutnya

Jalankan pada database `mansatas-db` dan kirimkan hasilnya secara aman:

```sql
PRAGMA table_list;
PRAGMA table_info(<tabel_siswa_yang_dipilih>);
```

Jika schema sumber berubah, verifikasi kembali:

- primary key siswa
- NISN/NIS (dipakai sebagai username dan password)
- nama lengkap
- kelas
- tingkat
- jenis kelamin
- status aktif

## Binding Wrangler

Binding berikut sudah aktif di `wrangler.toml`:

```toml
[[d1_databases]]
binding = "MANSATAS_DB"
database_name = "mansatas-db"
database_id = "76b7b346-3f3f-4c1e-a347-2d51497bad97"
```

Adapter memvalidasi identifier sebelum dipakai di SQL, hanya membaca database sekolah, dan tidak pernah menulis ke sana. Jika binding atau mapping tidak tersedia, login PMB tetap berjalan dan endpoint participant mansatas mengembalikan error konfigurasi yang jelas kepada admin.

## Migration

Jalankan `migration-multi-event.sql` pada D1 PMB existing setelah backup/readiness check. Untuk database baru, `schema.sql` sudah memuat tabel event dan roster.
