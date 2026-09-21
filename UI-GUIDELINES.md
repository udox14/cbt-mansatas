# UI-GUIDELINES.md — CBT MANSATAS

## Purpose

Dokumen ini menjaga CBT MANSATAS tetap terlihat seperti **produk internal sekolah yang matang**, bukan template SaaS hasil sekali prompt.

Target visual:
- tenang;
- padat informasi;
- jelas;
- institusional;
- modern secukupnya;
- tidak ramai;
- nyaman dipakai berjam-jam oleh admin/guru;
- mudah dipakai siswa saat kondisi ujian.

---

# 1. Existing Visual DNA

Pertahankan identitas yang sudah ada:

```text
Font utama       Plus Jakarta Sans
Arabic           Scheherazade New
Background       #F4F6F4
Surface          #FFFFFF
Border           #E0E5E0
Border strong    #D4DBD4
Text             #1E2E22
Text mid         #4A6655
Text muted       #8A9E8D
Text faint       #A8B9AA
Primary green    #2D7A4F
Green light      #E2EBE3
Green border     #B5D9C4
```

Existing identity Kemenag/MAN 1 Tasikmalaya tetap digunakan secara proporsional.

---

# 2. The Anti-AI-Slop Rules

Untuk UI baru, **jangan**:

- memakai gradient neon;
- memakai purple/indigo hanya karena “dashboard modern”;
- memakai glassmorphism;
- memakai blur/transparency berlebihan;
- membuat setiap section menjadi card;
- membuat setiap angka menjadi KPI card;
- memakai glow;
- memakai giant hero di halaman admin;
- memakai rounded-3xl di semua elemen;
- membuat semua tombol berbentuk pill;
- memakai emoji sebagai icon navigation production;
- mencampur 5 warna accent;
- membuat sidebar dengan icon warna-warni acak;
- membuat copy marketing seperti “Unlock your potential”;
- memakai illustration dekoratif yang tidak membantu tugas;
- membuat tabel berubah menjadi kartu besar pada desktop;
- menambah animasi hanya supaya terasa “premium”;
- membuat empty state terlalu teatrikal;
- menambah floating blob/background orb;
- menambah AI sparkle icon di semua tempat yang menyentuh AI.

Kalau suatu halaman terlihat cocok untuk dashboard startup crypto, ulang desainnya.

---

# 3. Brand Character

Visual harus terasa:

> “Sistem resmi MAN 1 Tasikmalaya yang dibuat dengan perhatian pada detail.”

Bukan:
> “Template admin generik berwarna hijau.”

Gunakan whitespace, alignment, typography, dan hierarchy sebagai sumber polish utama.

---

# 4. Color Usage

## Primary
Green dipakai untuk:
- primary action;
- selected navigation;
- active context;
- positive emphasis.

Jangan membuat seluruh halaman hijau.

## Semantic colors
Gunakan konsisten:

```text
Success  green
Info     blue
Warning  amber
Danger   red
Neutral  gray
```

Warna status hanya digunakan ketika memiliki makna.

Jangan memberi warna unik untuk setiap mode.

Mode dibedakan terutama dengan:
- label;
- icon;
- route;
- heading/context.

---

# 5. Typography

Base:
- Plus Jakarta Sans.
- Arabic content: Scheherazade New.

Suggested hierarchy:

```text
Page title        20–24 px / 800
Section title     15–17 px / 750–800
Card title        13–14 px / 700–800
Body              12.5–14 px / 500
Table             12–13 px
Meta              10.5–11.5 px
Label             10.5–11 px / 700
```

Jangan menggunakan text super besar di admin page.

Uppercase hanya untuk:
- tiny labels;
- status;
- table context tertentu.

Jangan uppercase paragraph.

---

# 6. Radius

Gunakan radius dengan disiplin:

```text
Input/button       8–10 px
Panel/card         10–12 px
Modal desktop      12–16 px
Mobile bottomsheet 20 px top
Badge/pill         999 px only when semantically a badge
```

Jangan membuat semua container rounded 20–32px.

---

# 7. Borders & Shadows

Default pemisah:
- border 1px / 1.5px.

Shadow:
- ringan;
- hanya untuk floating layer, modal, drawer;
- jangan pada setiap card.

Admin page sebaiknya lebih mengandalkan border daripada shadow.

---

# 8. Layout Shell

Desktop:

```text
Sidebar  220–240 px
Header   56–60 px
Content  fluid
```

Collapsed sidebar boleh sekitar 60px.

Mobile:
- sidebar menjadi drawer;
- header ringkas;
- critical context tetap terlihat.

Mode dan event aktif harus selalu jelas.

---

# 9. Mode Launcher

Setelah login, tampilkan mode yang user punya izin.

Launcher bukan marketing landing page.

Recommended:
- heading singkat;
- user identity;
- 2-column / 3-column compact mode list;
- icon Lucide;
- mode name;
- satu kalimat fungsi;
- optional count/status.

No giant illustrations.
No gradients.

Jika hanya satu mode tersedia, direct redirect diperbolehkan.

---

# 10. Mode Context

Di dalam mode, user harus bisa menjawab cepat:

1. Saya sedang di mode apa?
2. Event apa yang sedang dikelola?
3. Role/scope saya apa?

Gunakan compact context bar.

Contoh:

```text
Kegiatan / Seleksi OSN 2027
```

Jangan mengandalkan localStorage tersembunyi sebagai satu-satunya context.

---

# 11. Navigation

Sidebar:
- group based;
- icon Lucide 14–18px;
- label pendek;
- selected state background green-light;
- no emoji.

Bad:
```text
🌐 Dashboard
🎯 Ujian
✨ AI
```

Good:
```text
[LayoutDashboard] Dashboard
[ClipboardList] Ujian
[WandSparkles] Generator Soal
```

AI boleh memakai icon Lucide yang wajar, tanpa glitter visual tambahan.

---

# 12. Page Header

Page header berisi:
- title;
- one-line supporting context jika perlu;
- primary action di kanan.

Jangan:
- giant banner;
- 4 CTA setara;
- breadcrumb + hero + title + subtitle berulang.

---

# 13. Cards

Gunakan card bila informasi memang satu unit.

Jangan card-in-card-in-card.

Preferred:
- section surface;
- border;
- compact padding 14–20px.

Untuk data tabular, gunakan table, bukan grid kartu.

---

# 14. Tables

Admin CBT adalah aplikasi data-heavy.

Desktop:
- table first.

Requirements:
- sticky header jika panjang;
- alignment konsisten;
- numeric right/center sesuai kebutuhan;
- actions grouped;
- row hover subtle;
- bulk select jelas;
- pagination.

Mobile:
- boleh responsive compact card jika table benar-benar tidak muat;
- jangan hilangkan field penting;
- primary action tetap mudah diakses.

---

# 15. Forms

Form layout:
- label di atas;
- help text hanya bila dibutuhkan;
- validation dekat field;
- grouped by meaning.

Do not:
- membuat 20 field dalam satu modal;
- placeholder sebagai pengganti label;
- menyembunyikan required logic.

Complex config gunakan page/drawer, bukan modal kecil.

---

# 16. Buttons

Hierarchy:

```text
Primary     green filled
Secondary   neutral surface + border
Danger      red semantic
Ghost       low-emphasis
```

Satu section idealnya hanya punya satu obvious primary action.

Destructive action jangan berada berdampingan visual setara dengan primary tanpa separation.

Icon-only button:
- wajib tooltip/title/aria-label.

---

# 17. Badges

Badges untuk:
- status;
- role;
- small categorical metadata.

Jangan membuat semua teks kecil menjadi badge.

---

# 18. Tabs

Gunakan tabs untuk sub-area dalam satu entity.

Contoh exam:

```text
Soal
Peserta
Token
Monitor
Hasil
Analitik
```

Tabs tidak menggantikan route untuk domain besar.

Untuk halaman detail besar, URL subroute lebih baik agar refresh/deep-link aman.

---

# 19. Modals & Drawers

Modal:
- confirm;
- quick edit;
- small create form.

Drawer/page:
- complex config;
- multi-step edit;
- large participant selection.

Mobile modal existing bottom-sheet behavior boleh dipertahankan.

Do not nest modal inside modal.

---

# 20. Empty State

Empty state:
- icon sederhana;
- satu heading;
- satu kalimat;
- satu action bila relevan.

No cartoon.
No motivational prose.

Example:

```text
Belum ada ujian
Buat ujian pertama untuk event ini.
[Tambah Ujian]
```

---

# 21. Loading

Gunakan:
- skeleton untuk data-heavy page;
- spinner untuk action pendek;
- button loading state.

Jangan blank entire page bila hanya satu panel refresh.

Monitoring tidak boleh flicker setiap polling.

---

# 22. Error State

Error harus:
- mengatakan apa yang gagal;
- apa dampaknya;
- action retry bila memungkinkan.

Bad:
```text
Something went wrong.
```

Good:
```text
Data peserta dari MANSATAS App gagal dimuat.
Data CBT lain tetap dapat digunakan.
[Coba Lagi]
```

---

# 23. Readiness UI

Semester readiness adalah diagnostic tool.

Use grouped checklist:

```text
BLOCKER
- 2 mapel belum memiliki soal
- 1 slot belum memiliki pengawas

WARNING
- 3 meja terpaksa berisi peserta dari tingkat sama

READY
- 640 peserta sudah ditempatkan
```

Blocker red but calm.
Warning amber.
Success green.

Berikan deep-link ke sumber masalah.

---

# 24. Scheduling UI

Gunakan schedule grid/timeline yang membaca seperti jadwal sekolah.

Prioritas:
- tanggal;
- slot;
- jam;
- mapel;
- tingkat;
- status.

Drag/drop bukan requirement awal.
Correctness lebih penting daripada fancy interaction.

---

# 25. Seating UI

Admin perlu:
- ringkasan capacity;
- gender;
- grade distribution;
- violation indicator;
- manual override.

Visual denah meja hanya jika benar-benar dibutuhkan.

Jangan membuat 3D seating.

Seat label harus printable.

---

# 26. Invigilator UI

Table/matrix lebih baik daripada card.

Tampilkan:
- room;
- slot;
- teacher;
- workload;
- conflict.

Conflict harus terlihat tanpa hover.

Locked manual assignment punya icon lock + text/tooltip.

---

# 27. Monitoring UI

Monitoring harus density-friendly.

Per participant:
- name;
- room;
- connection;
- session state;
- answered count optional;
- heartbeat age;
- violations;
- action.

Status priority:
1. critical;
2. warning;
3. normal.

Jangan warna seluruh row merah kecuali benar-benar critical.

---

# 28. ExamRoom

ExamRoom bukan admin dashboard.

Principles:
- soal pusat perhatian;
- timer jelas;
- navigator stabil;
- submit jelas;
- distraction minimal;
- responsive;
- typography nyaman.

Pertahankan existing desktop three-region concept:
- navigator;
- question;
- status.

Mobile:
- question first;
- navigator accessible tanpa menutup progress penting.

Jangan menambahkan decoration mode-specific di ExamRoom yang mengganggu siswa.

---

# 29. Question Authoring

Editor layout harus mendukung:
- rich text;
- Arabic;
- formula;
- image;
- audio;
- options;
- answer key;
- explanation.

Question list:
- nomor;
- preview;
- type;
- points;
- actions.

No huge card per question on desktop unless editing.

---

# 30. AI Generator UI

Treat AI as authoring tool, not magic.

Suggested layout:

```text
Left / top:
Basic parameters
Difficulty profile
Thinking profile
Question style mix
Context/stimulus settings
Distractor quality
Topic coverage
Diversity

Blueprint preview

Main:
Generated draft list

Per item:
status
difficulty
thinking level
style
subtopic
stem
options
key
explanation
edit
select
regenerate item
```

## Blueprint Controls

Gunakan preset agar user tidak berhadapan dengan banyak slider sejak awal:

```text
Kesulitan:
[Dominan Mudah] [Balance] [Dominan Sulit] [Custom]

Variasi:
[Normal] [Tinggi]

Distraktor:
[Standar] [Ketat]
```

Advanced control dibuka melalui `Atur Detail`.

Untuk custom distribution, tampilkan persen sekaligus jumlah aktual:

```text
Mudah   30% → 12 soal
Sedang  40% → 16 soal
Sulit   30% → 12 soal
```

Blueprint preview harus ringkas dan terbaca sebelum user menyalin prompt.

Prominent text:
“Hasil AI perlu diperiksa sebelum disimpan.”

Do not:
- use animated gradient;
- show fake thinking;
- anthropomorphic chatbot mascot;
- auto-save to active exam.

Chat-like input boleh digunakan jika mengikuti pola RPPM Generator, tetapi hasil akhir tetap structured editor.

---

# 31. Responsive Breakpoints

Gunakan breakpoint existing Tailwind secara pragmatis.

Design target:
- phone 360px+
- tablet
- laptop
- 1440 desktop

Jangan desain hanya untuk monitor developer.

---

# 32. Touch Targets

Interactive target mobile:
- ideal 40px+;
- compact table action boleh lebih kecil jika spacing aman.

Critical exam controls harus mudah disentuh.

---

# 33. Accessibility

Minimum:
- semantic HTML;
- `label`;
- `aria-label` icon button;
- keyboard focus;
- sufficient contrast;
- disabled state clear;
- error text;
- not color-only status.

---

# 34. Motion

Motion:
- 120–220ms;
- fade/slide subtle.

No:
- spring bounce;
- confetti in admin;
- animated gradient;
- excessive page transition.

Exam submit success boleh memakai feedback sederhana, bukan celebratory animation yang berat.

---

# 35. Iconography

Use Lucide React.

Stroke:
- mostly 1.8–2.2.

Size:
- nav 14–18;
- button 14–16;
- empty state 20–28.

Jangan campur:
- emoji;
- Font Awesome;
- custom random SVG;
- Lucide

dalam satu surface tanpa alasan.

Logo Kemenag tetap asset resmi yang sudah ada.

---

# 36. Copywriting

Bahasa UI:
- Bahasa Indonesia;
- ringkas;
- operasional.

Gunakan:
- “Tambah Ujian”
- “Simpan Perubahan”
- “Aktifkan Event”
- “Pilih Peserta”

Hindari:
- “Mulai perjalanan Anda”
- “Optimalkan performa”
- “Transformasikan pengalaman ujian”
- copy SaaS generik.

---

# 37. Naming

Gunakan istilah konsisten:

```text
Mode
Event
Ujian
Mata Pelajaran
Peserta
Ruangan
Jadwal
Pengawas
Proktor
Token
Monitor
Hasil
Analitik
Generator Soal
```

Jangan berganti antara:
- activity/event/kegiatan

dalam UI yang sama.

Internal code boleh memakai `event`.

---

# 38. Information Density

CBT administration membutuhkan density sedang-tinggi.

Jangan takut table padat.

Polish berasal dari:
- spacing konsisten;
- typography;
- alignment;
- grouping;
- subtle border.

Bukan dari memperbesar semua komponen.

---

# 39. Design Tokens

Saat refactor frontend, pindahkan token visual dari object inline yang tersebar menuju shared tokens/CSS variables secara bertahap.

Target:

```css
--color-bg
--color-surface
--color-border
--color-border-strong
--color-text
--color-text-muted
--color-primary
--color-primary-soft
--color-danger
--color-warning
--radius-control
--radius-panel
```

Jangan melakukan rewrite seluruh styling dalam satu fase hanya untuk tokenization.

---

# 40. Review Checklist

Sebelum menyatakan UI selesai:

- [ ] Apakah route/context mode jelas?
- [ ] Apakah event aktif jelas?
- [ ] Apakah satu primary action terlihat?
- [ ] Apakah tabel digunakan untuk data tabular?
- [ ] Apakah ada card berlebihan?
- [ ] Apakah ada gradient/glass yang tidak perlu?
- [ ] Apakah ada emoji production yang seharusnya icon?
- [ ] Apakah warna punya makna?
- [ ] Apakah mobile usable?
- [ ] Apakah empty/loading/error state tersedia?
- [ ] Apakah authorization state tidak hanya disembunyikan UI?
- [ ] Apakah style mengikuti palette existing?
- [ ] Apakah halaman terasa seperti sistem sekolah, bukan template SaaS?
