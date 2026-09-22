// ============================================================
// Canonical TKA Subject Registry & Explicit Alias Resolver
//
// Defines verified institutional subjects for MAN 1 Tasikmalaya TKA
// and provides deterministic, non-fuzzy alias resolution.
// Strictly adheres to MANSATAS-INTEGRATION.md and Phase 5 specs.
// ============================================================

export type TkaSubjectCategory = 'wajib' | 'pilihan';

export interface CanonicalTkaSubject {
  canonicalKey: string;
  canonicalName: string;
  standardCode: string;
  category: TkaSubjectCategory;
}

/**
 * 3 Mandatory Subjects (Wajib)
 */
export const MANDATORY_TKA_SUBJECTS: Record<string, CanonicalTkaSubject> = {
  MATEMATIKA: {
    canonicalKey: 'MATEMATIKA',
    canonicalName: 'Matematika',
    standardCode: 'MAT',
    category: 'wajib',
  },
  BAHASA_INDONESIA: {
    canonicalKey: 'BAHASA_INDONESIA',
    canonicalName: 'Bahasa Indonesia',
    standardCode: 'BIN',
    category: 'wajib',
  },
  BAHASA_INGGRIS: {
    canonicalKey: 'BAHASA_INGGRIS',
    canonicalName: 'Bahasa Inggris',
    standardCode: 'BIG',
    category: 'wajib',
  },
};

/**
 * 19 Verified Institutional Elective Subjects (Pilihan)
 */
export const ELECTIVE_TKA_SUBJECTS: Record<string, CanonicalTkaSubject> = {
  MATEMATIKA_TINGKAT_LANJUT: {
    canonicalKey: 'MATEMATIKA_TINGKAT_LANJUT',
    canonicalName: 'Matematika Tingkat Lanjut',
    standardCode: 'MAT-L',
    category: 'pilihan',
  },
  BAHASA_INDONESIA_TINGKAT_LANJUT: {
    canonicalKey: 'BAHASA_INDONESIA_TINGKAT_LANJUT',
    canonicalName: 'Bahasa Indonesia Tingkat Lanjut',
    standardCode: 'BIN-L',
    category: 'pilihan',
  },
  BAHASA_INGGRIS_TINGKAT_LANJUT: {
    canonicalKey: 'BAHASA_INGGRIS_TINGKAT_LANJUT',
    canonicalName: 'Bahasa Inggris Tingkat Lanjut',
    standardCode: 'BIG-L',
    category: 'pilihan',
  },
  FISIKA: {
    canonicalKey: 'FISIKA',
    canonicalName: 'Fisika',
    standardCode: 'FIS',
    category: 'pilihan',
  },
  KIMIA: {
    canonicalKey: 'KIMIA',
    canonicalName: 'Kimia',
    standardCode: 'KIM',
    category: 'pilihan',
  },
  BIOLOGI: {
    canonicalKey: 'BIOLOGI',
    canonicalName: 'Biologi',
    standardCode: 'BIO',
    category: 'pilihan',
  },
  PPKN: {
    canonicalKey: 'PPKN',
    canonicalName: 'Pendidikan Pancasila dan Kewarganegaraan',
    standardCode: 'PPKN',
    category: 'pilihan',
  },
  EKONOMI: {
    canonicalKey: 'EKONOMI',
    canonicalName: 'Ekonomi',
    standardCode: 'EKO',
    category: 'pilihan',
  },
  GEOGRAFI: {
    canonicalKey: 'GEOGRAFI',
    canonicalName: 'Geografi',
    standardCode: 'GEO',
    category: 'pilihan',
  },
  SOSIOLOGI: {
    canonicalKey: 'SOSIOLOGI',
    canonicalName: 'Sosiologi',
    standardCode: 'SOS',
    category: 'pilihan',
  },
  SEJARAH: {
    canonicalKey: 'SEJARAH',
    canonicalName: 'Sejarah',
    standardCode: 'SEJ',
    category: 'pilihan',
  },
  ANTROPOLOGI: {
    canonicalKey: 'ANTROPOLOGI',
    canonicalName: 'Antropologi',
    standardCode: 'ANT',
    category: 'pilihan',
  },
  BAHASA_ARAB: {
    canonicalKey: 'BAHASA_ARAB',
    canonicalName: 'Bahasa Arab',
    standardCode: 'ARB',
    category: 'pilihan',
  },
  BAHASA_JEPANG: {
    canonicalKey: 'BAHASA_JEPANG',
    canonicalName: 'Bahasa Jepang',
    standardCode: 'JPN',
    category: 'pilihan',
  },
  BAHASA_JERMAN: {
    canonicalKey: 'BAHASA_JERMAN',
    canonicalName: 'Bahasa Jerman',
    standardCode: 'GER',
    category: 'pilihan',
  },
  BAHASA_PRANCIS: {
    canonicalKey: 'BAHASA_PRANCIS',
    canonicalName: 'Bahasa Prancis',
    standardCode: 'FRA',
    category: 'pilihan',
  },
  BAHASA_MANDARIN: {
    canonicalKey: 'BAHASA_MANDARIN',
    canonicalName: 'Bahasa Mandarin',
    standardCode: 'CHN',
    category: 'pilihan',
  },
  BAHASA_KOREA: {
    canonicalKey: 'BAHASA_KOREA',
    canonicalName: 'Bahasa Korea',
    standardCode: 'KOR',
    category: 'pilihan',
  },
  PKWU: {
    canonicalKey: 'PKWU',
    canonicalName: 'Projek Kreatif dan Kewirausahaan',
    standardCode: 'PKWU',
    category: 'pilihan',
  },
};

export const ALL_CANONICAL_TKA_SUBJECTS: Record<string, CanonicalTkaSubject> = {
  ...MANDATORY_TKA_SUBJECTS,
  ...ELECTIVE_TKA_SUBJECTS,
};

/**
 * Explicit non-fuzzy alias dictionary.
 * Maps exact lowercase, trimmed strings (with multiple spaces collapsed into a single space)
 * to canonical keys.
 * Zero guessing, zero Levenshtein, zero AI inference.
 */
export const TKA_ALIAS_MAP: Record<string, string> = {
  // ── Wajib ───────────────────────────────────────────────────
  'matematika': 'MATEMATIKA',
  'mat': 'MATEMATIKA',
  'matematika umum': 'MATEMATIKA',
  'matematika wajib': 'MATEMATIKA',

  'bahasa indonesia': 'BAHASA_INDONESIA',
  'indonesia': 'BAHASA_INDONESIA',
  'b. indonesia': 'BAHASA_INDONESIA',
  'b.indonesia': 'BAHASA_INDONESIA',
  'bin': 'BAHASA_INDONESIA',
  'bahasa indonesia wajib': 'BAHASA_INDONESIA',

  'bahasa inggris': 'BAHASA_INGGRIS',
  'inggris': 'BAHASA_INGGRIS',
  'b. inggris': 'BAHASA_INGGRIS',
  'b.inggris': 'BAHASA_INGGRIS',
  'big': 'BAHASA_INGGRIS',
  'bahasa inggris wajib': 'BAHASA_INGGRIS',

  // ── Pilihan: Sains & Matematika Lanjut ──────────────────────
  'matematika tingkat lanjut': 'MATEMATIKA_TINGKAT_LANJUT',
  'matematika lanjut': 'MATEMATIKA_TINGKAT_LANJUT',
  'matematika peminatan': 'MATEMATIKA_TINGKAT_LANJUT',
  'mat lanjut': 'MATEMATIKA_TINGKAT_LANJUT',
  'mat minat': 'MATEMATIKA_TINGKAT_LANJUT',
  'mat-l': 'MATEMATIKA_TINGKAT_LANJUT',

  'bahasa indonesia tingkat lanjut': 'BAHASA_INDONESIA_TINGKAT_LANJUT',
  'bahasa indonesia lanjut': 'BAHASA_INDONESIA_TINGKAT_LANJUT',
  'bahasa indonesia peminatan': 'BAHASA_INDONESIA_TINGKAT_LANJUT',
  'indonesia peminatan': 'BAHASA_INDONESIA_TINGKAT_LANJUT',
  'indo lanjut': 'BAHASA_INDONESIA_TINGKAT_LANJUT',
  'bin-l': 'BAHASA_INDONESIA_TINGKAT_LANJUT',

  'bahasa inggris tingkat lanjut': 'BAHASA_INGGRIS_TINGKAT_LANJUT',
  'bahasa inggris lanjut': 'BAHASA_INGGRIS_TINGKAT_LANJUT',
  'bahasa inggris peminatan': 'BAHASA_INGGRIS_TINGKAT_LANJUT',
  'inggris peminatan': 'BAHASA_INGGRIS_TINGKAT_LANJUT',
  'inggris lanjut': 'BAHASA_INGGRIS_TINGKAT_LANJUT',
  'big-l': 'BAHASA_INGGRIS_TINGKAT_LANJUT',

  'fisika': 'FISIKA',
  'fis': 'FISIKA',

  'kimia': 'KIMIA',
  'kim': 'KIMIA',

  'biologi': 'BIOLOGI',
  'bio': 'BIOLOGI',

  // ── Pilihan: Sosial & Humaniora ─────────────────────────────
  'pendidikan pancasila dan kewarganegaraan': 'PPKN',
  'pendidikan pancasila': 'PPKN',
  'ppkn': 'PPKN',
  'pkn': 'PPKN',

  'ekonomi': 'EKONOMI',
  'eko': 'EKONOMI',

  'geografi': 'GEOGRAFI',
  'geo': 'GEOGRAFI',

  'sosiologi': 'SOSIOLOGI',
  'sos': 'SOSIOLOGI',

  'sejarah': 'SEJARAH',
  'sej': 'SEJARAH',
  'sejarah peminatan': 'SEJARAH',

  'antropologi': 'ANTROPOLOGI',
  'ant': 'ANTROPOLOGI',

  // ── Pilihan: Bahasa Asing ───────────────────────────────────
  'bahasa arab': 'BAHASA_ARAB',
  'arab': 'BAHASA_ARAB',
  'b. arab': 'BAHASA_ARAB',
  'arb': 'BAHASA_ARAB',

  'bahasa jepang': 'BAHASA_JEPANG',
  'jepang': 'BAHASA_JEPANG',
  'b. jepang': 'BAHASA_JEPANG',
  'jpn': 'BAHASA_JEPANG',

  'bahasa jerman': 'BAHASA_JERMAN',
  'jerman': 'BAHASA_JERMAN',
  'b. jerman': 'BAHASA_JERMAN',
  'ger': 'BAHASA_JERMAN',

  'bahasa prancis': 'BAHASA_PRANCIS',
  'prancis': 'BAHASA_PRANCIS',
  'b. prancis': 'BAHASA_PRANCIS',
  'fra': 'BAHASA_PRANCIS',

  'bahasa mandarin': 'BAHASA_MANDARIN',
  'mandarin': 'BAHASA_MANDARIN',
  'b. mandarin': 'BAHASA_MANDARIN',
  'chn': 'BAHASA_MANDARIN',

  'bahasa korea': 'BAHASA_KOREA',
  'korea': 'BAHASA_KOREA',
  'b. korea': 'BAHASA_KOREA',
  'kor': 'BAHASA_KOREA',

  // ── Pilihan: Kejuruan / Vokasi ──────────────────────────────
  'projek kreatif dan kewirausahaan': 'PKWU',
  'prakarya dan kewirausahaan': 'PKWU',
  'kewirausahaan': 'PKWU',
  'pkwu': 'PKWU',
  'prakarya': 'PKWU',
};

/**
 * Resolves a raw string choice to a CanonicalTkaSubject deterministically.
 * If raw is missing, empty, or unmapped, returns null.
 */
export function resolveCanonicalTkaSubject(
  raw: string | null | undefined
): CanonicalTkaSubject | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return null;

  const key = TKA_ALIAS_MAP[clean];
  if (!key) return null;

  return ALL_CANONICAL_TKA_SUBJECTS[key] || null;
}

/**
 * Matches a canonical subject to an authoritative Mansatas mata_pelajaran row.
 * Matches by exact kode_mapel or canonical nama_mapel.
 */
export function matchMansatasSubjectRow(
  canonical: CanonicalTkaSubject,
  mataPelajaranRows: Array<{ id: string; nama_mapel: string; kode_mapel?: string | null }>
): { id: string; nama_mapel: string } | null {
  // 1. Match by kode_mapel (e.g. 'MAT', 'FIS', 'KIM')
  const byCode = mataPelajaranRows.find(
    (m) =>
      m.kode_mapel &&
      m.kode_mapel.trim().toUpperCase() === canonical.standardCode.toUpperCase()
  );
  if (byCode) return { id: byCode.id, nama_mapel: byCode.nama_mapel };

  // 2. Match by exact canonical name
  const byName = mataPelajaranRows.find(
    (m) =>
      m.nama_mapel &&
      m.nama_mapel.trim().toLowerCase() === canonical.canonicalName.toLowerCase()
  );
  if (byName) return { id: byName.id, nama_mapel: byName.nama_mapel };

  // 3. Fallback match via alias table against nama_mapel
  const byAlias = mataPelajaranRows.find((m) => {
    const mapelClean = m.nama_mapel.trim().toLowerCase().replace(/\s+/g, ' ');
    const mapelCanonicalKey = TKA_ALIAS_MAP[mapelClean];
    return mapelCanonicalKey === canonical.canonicalKey;
  });
  if (byAlias) return { id: byAlias.id, nama_mapel: byAlias.nama_mapel };

  return null;
}

/**
 * Resolves an authoritative Mansatas mata_pelajaran row to a CanonicalTkaSubject.
 * Matches via:
 * 1. nama_mapel against the deterministic alias map
 * 2. nama_mapel against canonicalName of all canonical subjects
 * 3. kode_mapel against standardCode of all canonical subjects
 * 4. kode_mapel against the deterministic alias map
 * Returns null if the subject is not part of the institutional canonical TKA subject registry.
 */
export function resolveSubjectRowToCanonical(
  mapelRow: { id?: string; nama_mapel?: string | null; kode_mapel?: string | null }
): CanonicalTkaSubject | null {
  if (!mapelRow) return null;

  // 1. Try matching nama_mapel against alias map
  if (mapelRow.nama_mapel) {
    const byAlias = resolveCanonicalTkaSubject(mapelRow.nama_mapel);
    if (byAlias) return byAlias;

    const cleanName = mapelRow.nama_mapel.trim().toLowerCase();
    const byName = Object.values(ALL_CANONICAL_TKA_SUBJECTS).find(
      (c) => c.canonicalName.toLowerCase() === cleanName
    );
    if (byName) return byName;
  }

  // 2. Try matching kode_mapel against standardCode or alias map
  if (mapelRow.kode_mapel) {
    const cleanCode = mapelRow.kode_mapel.trim().toUpperCase();
    const byCode = Object.values(ALL_CANONICAL_TKA_SUBJECTS).find(
      (c) => c.standardCode.toUpperCase() === cleanCode
    );
    if (byCode) return byCode;

    const byCodeAlias = resolveCanonicalTkaSubject(mapelRow.kode_mapel);
    if (byCodeAlias) return byCodeAlias;
  }

  return null;
}

/**
 * Validates that a subject_id for a TKA exam satisfies BOTH:
 * 1. Exists in Mansatas mata_pelajaran
 * 2. Resolves to one of the institutional canonical TKA subjects defined by the verified TKA subject registry
 *
 * Rejects:
 * - Empty / whitespace subject_id
 * - Synthetic tka-* subject IDs
 * - Subject IDs not found in Mansatas mata_pelajaran
 * - Subject IDs found in Mansatas mata_pelajaran but NOT belonging to the canonical TKA subject registry
 */
export async function assertAllowedTkaSubjectId(
  mansatasDb: D1Database,
  subjectId: string
): Promise<{
  success: boolean;
  subjectName?: string;
  canonicalSubject?: CanonicalTkaSubject;
  error?: string;
}> {
  const cleanSubjectId = (subjectId || '').trim();
  if (!cleanSubjectId) {
    return {
      success: false,
      error: 'Ujian TKA wajib memiliki subject_id yang valid dan tidak boleh kosong',
    };
  }

  if (cleanSubjectId.toLowerCase().startsWith('tka-')) {
    return {
      success: false,
      error: 'Identifier subject_id sintetis dilarang untuk ujian TKA. Gunakan ID resmi mata pelajaran Mansatas (tidak valid atau tidak terdaftar).',
    };
  }

  if (!mansatasDb) {
    return {
      success: false,
      error: 'Database Mansatas tidak tersedia untuk verifikasi mata pelajaran TKA',
    };
  }

  let mapelRow: any = null;
  try {
    mapelRow = await mansatasDb
      .prepare('SELECT id, nama_mapel, kode_mapel FROM mata_pelajaran WHERE id = ?')
      .bind(cleanSubjectId)
      .first<any>();
  } catch {
    mapelRow = await mansatasDb
      .prepare('SELECT id, nama_mapel FROM mata_pelajaran WHERE id = ?')
      .bind(cleanSubjectId)
      .first<any>();
  }

  if (!mapelRow || !mapelRow.id) {
    return {
      success: false,
      error: `Mata pelajaran '${cleanSubjectId}' tidak valid atau tidak terdaftar (tidak ditemukan di database Mansatas atau tidak terverifikasi)`,
    };
  }

  const canonical = resolveSubjectRowToCanonical(mapelRow);
  if (!canonical) {
    return {
      success: false,
      error: `Mata pelajaran '${mapelRow.nama_mapel}' (${cleanSubjectId}) bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal`,
    };
  }

  return {
    success: true,
    subjectName: mapelRow.nama_mapel,
    canonicalSubject: canonical,
  };
}
