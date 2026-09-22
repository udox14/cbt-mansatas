import { newId, now } from '../../utils/helpers.ts';


export async function listRooms(db: D1Database, query: { event_id?: string }) {
  let roomsSql = `
    SELECT r.*, e.code as event_code, e.name as event_name,
      (SELECT GROUP_CONCAT(cu.nama_lengkap, ', ') FROM cbt_users cu WHERE cu.room_id = r.id AND cu.role = 'proctor') as proctor_names
    FROM cbt_rooms r
    LEFT JOIN cbt_events e ON e.id = r.event_id
  `;
  const roomParams: any[] = [];
  if (query.event_id) {
    roomsSql += ` WHERE r.event_id = ? OR r.event_id IS NULL`;
    roomParams.push(query.event_id);
  }
  roomsSql += ` ORDER BY r.room_name`;

  const { results: roomRows } = await db.prepare(roomsSql).bind(...roomParams).all();
  const rooms = (roomRows as any[]) || [];

  // Count participants per room canonically from cbt_exam_roster & cbt_users
  const rosterCountMap = new Map<string, number>();
  try {
    let rosterSql = `SELECT r.room_id, rm.room_name
                     FROM cbt_exam_roster r
                     LEFT JOIN cbt_rooms rm ON rm.id = r.room_id
                     WHERE (r.room_id IS NOT NULL OR rm.room_name IS NOT NULL)`;
    const rosterParams: any[] = [];
    if (query.event_id) {
      rosterSql += ` AND r.event_id = ?`;
      rosterParams.push(query.event_id);
    }
    const { results: rosterRows } = await db.prepare(rosterSql).bind(...rosterParams).all();
    for (const row of (rosterRows as any[]) || []) {
      const key = row.room_id || row.room_name;
      if (key) rosterCountMap.set(key, (rosterCountMap.get(key) || 0) + 1);
    }
  } catch {}

  const cbtUserCountMap = new Map<string, number>();
  try {
    const { results: userRows } = await db.prepare(
      "SELECT room_id FROM cbt_users WHERE role = 'student' AND room_id IS NOT NULL"
    ).all();
    for (const row of (userRows as any[]) || []) {
      if (row.room_id) cbtUserCountMap.set(row.room_id, (cbtUserCountMap.get(row.room_id) || 0) + 1);
    }
  } catch {}

  return rooms.map(r => {
    const rosterCount = rosterCountMap.get(r.id) || rosterCountMap.get(r.room_name) || 0;
    const cbtCount = cbtUserCountMap.get(r.id) || 0;
    return {
      ...r,
      jumlah_peserta: rosterCount + cbtCount,
    };
  });
}

export async function createRoom(
  db: D1Database,
  b: { room_name: string; capacity?: number; event_id?: string | null }
) {
  const roomName = String(b.room_name || '').trim();
  const roomCapacity = Math.max(1, Number(b.capacity || 40) || 40);
  const eventId = b.event_id ? String(b.event_id).trim() : null;

  if (!roomName) {
    return { success: false, error: 'Nama ruangan wajib diisi', status: 400 };
  }

  const existing = await db.prepare('SELECT id FROM cbt_rooms WHERE room_name = ?').bind(roomName).first();
  if (existing) {
    return { success: false, error: 'Nama ruangan sudah ada', status: 400 };
  }

  const id = newId();
  await db.prepare('INSERT INTO cbt_rooms (id, room_name, capacity, event_id) VALUES (?,?,?,?)')
    .bind(id, roomName, roomCapacity, eventId).run();

  return { success: true, data: { id, room_name: roomName, capacity: roomCapacity, event_id: eventId }, message: 'Ruangan ditambahkan' };
}

export async function updateRoom(
  db: D1Database,
  id: string,
  b: { room_name?: string; capacity?: number; event_id?: string | null }
) {
  const existing = await db.prepare('SELECT id, room_name, capacity, event_id FROM cbt_rooms WHERE id=?').bind(id).first<any>();
  if (!existing) {
    return { success: false, error: 'Ruangan tidak ditemukan', status: 404 };
  }

  const roomName = b.room_name !== undefined ? String(b.room_name).trim() : existing.room_name;
  const roomCapacity = b.capacity !== undefined ? Math.max(1, Number(b.capacity) || 40) : undefined;
  const eventId = b.event_id !== undefined ? (b.event_id ? String(b.event_id).trim() : null) : existing.event_id;

  if (b.room_name !== undefined && !roomName) {
    return { success: false, error: 'Nama ruangan wajib diisi', status: 400 };
  }

  if (roomName !== existing.room_name) {
    const duplicate = await db.prepare('SELECT id FROM cbt_rooms WHERE room_name = ? AND id != ?').bind(roomName, id).first();
    if (duplicate) {
      return { success: false, error: 'Nama ruangan sudah ada', status: 400 };
    }
  }

  if (roomCapacity !== undefined && roomCapacity !== existing.capacity) {
    try {
      const layout = await db
        .prepare('SELECT * FROM cbt_semester_room_layouts WHERE room_id = ?')
        .bind(id)
        .first<any>();

      if (layout) {
        if (layout.layout_type === 'physical_configured' && layout.total_seats !== roomCapacity) {
          return {
            success: false,
            error: `Kapasitas ruangan tidak dapat diubah karena ruangan ini memiliki denah fisik terkonfigurasi (${layout.total_seats} kursi). Perbarui tata letak fisik terlebih dahulu.`,
            status: 400,
          };
        } else if (layout.layout_type === 'logical_fallback') {
          // Check if decreasing below current assigned participants
          const participantCount = await db
            .prepare('SELECT COUNT(*) as cnt FROM cbt_semester_participants WHERE room_id = ?')
            .bind(id)
            .first<{ cnt: number }>();
          if ((participantCount?.cnt || 0) > roomCapacity) {
            return {
              success: false,
              error: `Kapasitas tidak dapat dikurangi di bawah jumlah siswa yang saat ini terdaftar di ruangan (${participantCount?.cnt || 0} siswa).`,
              status: 400,
            };
          }

          // Atomically reconcile logical seats and layout total_seats
          const batchStatements: any[] = [
            db.prepare('UPDATE cbt_rooms SET room_name=COALESCE(?, room_name), capacity=COALESCE(?, capacity), event_id=? WHERE id=?')
              .bind(roomName, roomCapacity ?? null, eventId, id),
            db.prepare("UPDATE cbt_semester_room_layouts SET total_seats = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(roomCapacity, layout.id),
          ];

          if (roomCapacity > existing.capacity) {
            for (let s = existing.capacity + 1; s <= roomCapacity; s++) {
              batchStatements.push(
                db.prepare(`
                  INSERT OR IGNORE INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label, row_num, col_num, sequence_order)
                  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
                `).bind(newId(), layout.event_id, id, s, `K-${String(s).padStart(2, '0')}`, s, s)
              );
            }
          } else if (roomCapacity < existing.capacity) {
            batchStatements.push(
              db.prepare('DELETE FROM cbt_semester_seats WHERE room_id = ? AND seat_number > ?')
                .bind(id, roomCapacity)
            );
          }

          await db.batch(batchStatements);
          return { success: true, data: null, message: 'Ruangan dan denah logis berhasil diperbarui' };
        }
      }
    } catch (err: any) {
      if (!err?.message?.includes('no such table')) {
        throw err;
      }
    }
  }

  await db.prepare(
    'UPDATE cbt_rooms SET room_name=COALESCE(?, room_name), capacity=COALESCE(?, capacity), event_id=? WHERE id=?'
  ).bind(roomName, roomCapacity ?? null, eventId, id).run();

  return { success: true, data: null, message: 'Ruangan diperbarui' };
}

export async function deleteRoom(db: D1Database, id: string) {
  const room = await db.prepare('SELECT id, room_name FROM cbt_rooms WHERE id=?').bind(id).first<any>();
  if (!room) {
    return { success: false, error: 'Ruangan tidak ditemukan', status: 404 };
  }

  const sessionCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE room_id=?'
  ).bind(room.id).first<any>();
  if ((sessionCount?.cnt || 0) > 0) {
    return { success: false, error: 'Ruangan tidak bisa dihapus karena sudah memiliki sesi ujian', status: 400 };
  }

  await db.batch([
    db.prepare('UPDATE cbt_users SET room_id=NULL, updated_at=? WHERE room_id=?').bind(now(), room.id),
    db.prepare('UPDATE cbt_exam_roster SET room_id=NULL WHERE room_id=?').bind(room.id),
    db.prepare('DELETE FROM cbt_exam_tokens WHERE room_id=?').bind(room.id),
    db.prepare("DELETE FROM cbt_exam_assignments WHERE user_type='room' AND user_id=?").bind(room.room_name),
    db.prepare('DELETE FROM cbt_rooms WHERE id=?').bind(room.id),
  ]);

  return { success: true, data: null, message: 'Ruangan dihapus' };
}

export async function listProctors(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT u.id, u.username, u.nama_lengkap, u.role, u.room_id, r.room_name
     FROM cbt_users u
     LEFT JOIN cbt_rooms r ON r.id = u.room_id
     WHERE u.role = 'proctor' AND u.is_active = 1
     ORDER BY u.nama_lengkap`
  ).all();
  return results || [];
}

export async function assignProctor(db: D1Database, id: string, roomId: string | null) {
  const proctor = await db.prepare(
    "SELECT id FROM cbt_users WHERE id=? AND role='proctor'"
  ).bind(id).first();
  if (!proctor) {
    return { success: false, error: 'Proktor tidak ditemukan', status: 404 };
  }

  if (roomId) {
    const room = await db.prepare('SELECT id FROM cbt_rooms WHERE id=?').bind(roomId).first();
    if (!room) {
      return { success: false, error: 'Ruangan tidak ditemukan', status: 404 };
    }
  }

  await db.prepare(
    "UPDATE cbt_users SET room_id=?, updated_at=datetime('now') WHERE id=?"
  ).bind(roomId || null, id).run();

  return { success: true, data: null, message: 'Proktor berhasil ditugaskan' };
}
