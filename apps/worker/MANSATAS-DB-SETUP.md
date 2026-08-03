# Aktivasi sumber peserta `mansatas-db`

Kode CBT sudah memiliki adapter `mansatas`, tetapi binding tidak diaktifkan otomatis karena database ID, nama tabel, dan nama kolom belum tersedia di workspace. Jangan mengisi mapping berdasarkan tebakan.

## Data yang diperlukan

Jalankan pada database `mansatas-db` dan kirimkan hasilnya secara aman:

```sql
PRAGMA table_list;
PRAGMA table_info(<tabel_siswa_yang_dipilih>);
```

Mapping wajib:

- primary key siswa
- NISN/NIS (dipakai sebagai username dan password)
- nama lengkap
- kelas
- tingkat
- jenis kelamin
- status aktif

## Binding Wrangler

Setelah database ID dikonfirmasi, tambahkan blok berikut ke `wrangler.toml` dan isi UUID sebenarnya:

```toml
[[d1_databases]]
binding = "MANSATAS_DB"
database_name = "mansatas-db"
database_id = "<MANSATAS_DB_DATABASE_ID>"
```

Tambahkan mapping non-rahasia berikut pada `[vars]`:

```toml
MANSATAS_DB_TABLE = "<table>"
MANSATAS_DB_ID_COLUMN = "<primary_key>"
MANSATAS_DB_NISN_COLUMN = "<nisn_or_nis>"
MANSATAS_DB_NAME_COLUMN = "<full_name>"
MANSATAS_DB_CLASS_COLUMN = "<class>"
MANSATAS_DB_GRADE_COLUMN = "<grade>"
MANSATAS_DB_GENDER_COLUMN = "<gender>"
MANSATAS_DB_ACTIVE_COLUMN = "<active_status>"
# Opsional bila status aktif memakai nilai selain 1/true/aktif:
# MANSATAS_DB_ACTIVE_VALUE = "<active_value>"
```

Adapter memvalidasi identifier sebelum dipakai di SQL, hanya membaca database sekolah, dan tidak pernah menulis ke sana. Tanpa binding atau mapping lengkap, login PMB tetap berjalan; endpoint participant mansatas mengembalikan error konfigurasi yang jelas kepada admin.

## Migration

Jalankan `migration-multi-event.sql` pada D1 PMB existing setelah backup/readiness check. Untuk database baru, `schema.sql` sudah memuat tabel event dan roster.
