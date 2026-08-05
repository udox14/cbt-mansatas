// ── Deteksi teks berbahasa Arab untuk rendering RTL ──────
// Aturan: RTL diterapkan jika kata/huruf pertama dalam teks
// (setelah mengabaikan nomor soal, simbol, HTML tag, & formula math)
// adalah aksara Arab.

const ARABIC_CHARS_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const FIRST_LETTER_RE =
  /[A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Mengembalikan true jika kata/huruf pertama dari teks (setelah tag HTML,
 * entitas, nomor, dan simbol dihilangkan) beraksara Arab.
 */
export function isFullArabic(html: string | null | undefined): boolean {
  if (!html) return false;

  const text = html
    // Hapus elemen math/katex HTML yang ter-render
    .replace(/<span[^>]*class="[^"]*(?:math-inline|math-block|katex)[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')
    .replace(/<div[^>]*class="[^"]*(?:math-inline|math-block|katex)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, ' ')
    // Hapus tag HTML
    .replace(/<[^>]+>/g, ' ')
    // Hapus entitas HTML
    .replace(/&[a-z0-9#]+;/gi, ' ')
    // Hapus formula math LaTeX dalam delimiter $...$, $$...$$, \[...\], \(...\)
    .replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, ' ');

  const match = text.match(FIRST_LETTER_RE);
  if (!match) return false;

  return ARABIC_CHARS_RE.test(match[0]);
}

