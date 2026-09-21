import { newId, generateToken, ok, err } from '../../utils/helpers.ts';


export async function getAssignedTokenTargets(db: D1Database, examId: string) {
  const targets = new Map<string, { room_id: string; tanggal_tes: string; sesi_tes: string }>();
  const add = (roomId?: string | null, tanggalTes?: string | null, sesiTes?: string | null) => {
    if (!roomId) return;
    const target = {
      room_id: roomId,
      tanggal_tes: tanggalTes || '',
      sesi_tes: sesiTes || '',
    };
    targets.set(`${target.room_id}|${target.tanggal_tes}|${target.sesi_tes}`, target);
  };

  const { results: roomRows } = await db.prepare('SELECT id, room_name FROM cbt_rooms').all();
  const roomNameToIdMap = new Map<string, string>();
  for (const r of (roomRows as any[]) || []) roomNameToIdMap.set(r.room_name, r.id);

  // 1. From canonical roster snapshot
  const { results: rosterTargets } = await db.prepare(
    `SELECT DISTINCT room_id, tanggal_tes, sesi_tes
     FROM cbt_exam_roster WHERE exam_id=? AND room_id IS NOT NULL`
  ).bind(examId).all();
  for (const target of (rosterTargets as any[]) || []) {
    add(target.room_id, target.tanggal_tes, target.sesi_tes);
  }

  // 2. From exam assignments
  const { results: assignments } = await db.prepare(
    'SELECT user_id, user_type FROM cbt_exam_assignments WHERE exam_id=?'
  ).bind(examId).all();

  for (const a of (assignments as any[]) || []) {
    if (a.user_type === 'cbt_user') {
      const u = await db.prepare(
        "SELECT room_id FROM cbt_users WHERE id=? AND role='student' AND is_active=1"
      ).bind(a.user_id).first<any>();
      add(u?.room_id, '', '');
      continue;
    }

    if (a.user_type === 'room') {
      const roomId = roomNameToIdMap.get(a.user_id) || a.user_id;
      add(roomId, '', '');
    }
  }

  return Array.from(targets.values()).sort((a, b) =>
    `${a.tanggal_tes} ${a.sesi_tes} ${a.room_id}`.localeCompare(`${b.tanggal_tes} ${b.sesi_tes} ${b.room_id}`)
  );
}

export async function listExamTokens(db: D1Database, examId: string) {
  const { results } = await db.prepare(
    `SELECT t.*, r.room_name
     FROM cbt_exam_tokens t
     JOIN cbt_rooms r ON r.id = t.room_id
     WHERE t.exam_id = ?
     ORDER BY r.room_name`
  ).bind(examId).all();
  return results || [];
}

export async function toggleTokenActive(
  db: D1Database,
  examId: string,
  tokenId: string,
  isActive: number | boolean
) {
  const token = await db.prepare(
    'SELECT id FROM cbt_exam_tokens WHERE id=? AND exam_id=?'
  ).bind(tokenId, examId).first();
  if (!token) {
    return { success: false, error: 'Token tidak ditemukan', status: 404 };
  }

  const activeVal = isActive === 1 || isActive === true ? 1 : 0;
  await db.prepare(
    'UPDATE cbt_exam_tokens SET is_active=? WHERE id=? AND exam_id=?'
  ).bind(activeVal, tokenId, examId).run();
  return { success: true, data: { is_active: activeVal }, message: 'Status token diubah' };
}

export async function generateExamTokens(
  db: D1Database,
  examId: string,
  options: {
    room_ids?: string[];
    groups?: { tanggal_tes?: string; sesi_tes?: string }[];
    token_id?: string;
  }
) {
  if (options.token_id) {
    const token = await db.prepare(
      'SELECT id FROM cbt_exam_tokens WHERE id=? AND exam_id=?'
    ).bind(options.token_id, examId).first();
    if (!token) return { success: false, error: 'Token tidak ditemukan', status: 404 };

    await db.prepare(
      "UPDATE cbt_exam_tokens SET token_code=?, is_active=1, created_at=datetime('now') WHERE id=? AND exam_id=?"
    ).bind(generateToken(), options.token_id, examId).run();
    return { success: true, data: { generated: 1 }, message: 'Token berhasil digenerate ulang' };
  }

  let targetRows = await getAssignedTokenTargets(db, examId);
  if (options.room_ids?.length) {
    targetRows = targetRows.filter(t => options.room_ids!.includes(t.room_id));
  }
  if (options.groups?.length) {
    const allowedGroups = new Set(options.groups.map(g => `${g.tanggal_tes || ''}|${g.sesi_tes || ''}`));
    targetRows = targetRows.filter(t => allowedGroups.has(`${t.tanggal_tes}|${t.sesi_tes}`));
  }

  const isFullGenerate = !options.room_ids?.length && !options.groups?.length;
  if (!targetRows.length) {
    if (isFullGenerate) {
      await db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id=?').bind(examId).run();
    }
    return {
      success: false,
      error: 'Belum ada peserta/ruangan/sesi yang di-assign ke ujian ini',
      status: 400,
    };
  }

  if (isFullGenerate) {
    await db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id=?').bind(examId).run();
  }

  const stmts: any[] = [];
  for (const target of targetRows) {
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO cbt_exam_tokens
         (id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active)
         VALUES (?,?,?,?,?,?,1)`
      ).bind(newId(), examId, target.room_id, target.tanggal_tes, target.sesi_tes, generateToken())
    );
  }

  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { generated: stmts.length }, message: 'Token berhasil digenerate' };
}

export async function setExamTokenCode(db: D1Database, examId: string, rawCode?: string) {
  const tokenCode = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(tokenCode)) {
    return { success: false, error: 'Token manual harus 4-20 karakter, hanya huruf dan angka', status: 400 };
  }

  const targetRows = await getAssignedTokenTargets(db, examId);
  if (!targetRows.length) {
    return { success: false, error: 'Belum ada peserta/ruangan/sesi yang di-assign ke ujian ini', status: 400 };
  }

  await db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id=?').bind(examId).run();

  const stmts: any[] = [];
  for (const target of targetRows) {
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO cbt_exam_tokens
         (id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active, created_at)
         VALUES (?,?,?,?,?,?,1,datetime('now'))`
      ).bind(newId(), examId, target.room_id, target.tanggal_tes, target.sesi_tes, tokenCode)
    );
  }

  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  return { success: true, data: { updated: targetRows.length, token_code: tokenCode }, message: `Token diset menjadi ${tokenCode}` };
}
