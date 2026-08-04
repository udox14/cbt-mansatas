// ── Deteksi teks "full berbahasa Arab" untuk rendering RTL ──────
// Aturan: RTL hanya jika seluruh isi teks beraksara Arab TANPA huruf
// Latin sama sekali. Soal campuran (Indo/Inggris + kutipan Arab) tetap LTR.

const ARABIC_CHARS_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_CHARS_RE = /[A-Za-z]/;

/**
 * Mengembalikan true jika HTML berisi aksara Arab dan tidak mengandung
 * huruf Latin sama sekali (setelah tag, entitas, angka, dan tanda baca
 * dihilangkan). Mengandung LaTeX/math berhuruf Latin → dianggap LTR.
 */
export function isFullArabic(html: string | null | undefined): boolean {
  const text = (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/[$\\\[\]{}]/g, ' ');

  const letters = text.replace(
    /[^A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g,
    ''
  );

  return ARABIC_CHARS_RE.test(letters) && !LATIN_CHARS_RE.test(letters);
}
