const pool = require("../config/db");

const getBranchId = (req, res) => {
  const branchId = req.admin.branch_id;
  if (!branchId) {
    res.status(403).json({ success: false, message: "Admin belum terhubung ke cabang" });
    return null;
  }
  return branchId;
};

const detectClashes = async (client, branchId, data, excludeId = 0) => {
  const { date, start_time, end_time, room_name_id, staff_ids = [] } = data;
  const clashes = [];
  const roomClash = await client.query(
    `SELECT
       s.id,
       TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
       TO_CHAR(s.end_time, 'HH24:MI') AS end_time,
       rn.name AS room_name
     FROM schedule s
     JOIN room_name rn ON s.room_name_id = rn.id
     WHERE s.branch_id = $1
       AND s.room_name_id = $2
       AND s.date = $3::date
       AND s.start_time < $4::time
       AND s.end_time > $5::time
       AND s.id != $6`,
    [branchId, room_name_id, date, end_time, start_time, excludeId]
  );

  if (roomClash.rows.length > 0) {
    const c = roomClash.rows[0];
    clashes.push({
      type: "room",
      message: `Ruangan "${c.room_name}" sudah digunakan pada jam ${c.start_time} – ${c.end_time}`,
    });
  }

  if (staff_ids.length > 0) {
    const staffClash = await client.query(
      `SELECT
         DISTINCT ON (st.id)
         st.name AS staff_name,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
         TO_CHAR(s.end_time, 'HH24:MI') AS end_time
       FROM schedule s
       JOIN schedule_staff ss ON s.id = ss.schedule_id
       JOIN staff st ON ss.staff_id = st.id
       WHERE s.branch_id = $1
         AND ss.staff_id = ANY($2)
         AND s.date = $3::date
         AND s.start_time < $4::time
         AND s.end_time > $5::time
         AND s.id != $6
       ORDER BY st.id, s.start_time`,
      [branchId, staff_ids, date, end_time, start_time, excludeId]
    );

    if (staffClash.rows.length > 0) {
      const names = staffClash.rows.map((r) => r.staff_name).join(", ");
      const t = staffClash.rows[0];
      clashes.push({
        type: "staff",
        message: `Staff [${names}] sudah memiliki jadwal lain pada jam ${t.start_time} – ${t.end_time}`,
      });
    }
  }

  return clashes;
};

const fetchScheduleById = async (scheduleId) => {
  const result = await pool.query(
    `SELECT
       s.id,
       TO_CHAR(s.date, 'YYYY-MM-DD')       AS date,
       TO_CHAR(s.start_time, 'HH24:MI')    AS start_time,
       TO_CHAR(s.end_time, 'HH24:MI')      AS end_time,
       s.duration_minutes,
       s.timezone,
       st.id  AS service_type_id,  st.name AS service_type_name,
       sn.id  AS service_name_id,  sn.name AS service_name_name,
       rt.id  AS room_type_id,     rt.name AS room_type_name,
       rn.id  AS room_name_id,     rn.name AS room_name_name,
       rn.capacity AS room_capacity
     FROM schedule s
     JOIN service_type st ON s.service_type_id = st.id
     JOIN service_name sn ON s.service_name_id = sn.id
     JOIN room_type rt    ON s.room_type_id = rt.id
     JOIN room_name rn    ON s.room_name_id = rn.id
     WHERE s.id = $1`,
    [scheduleId]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  const staffResult = await pool.query(
    `SELECT st.id, st.name FROM schedule_staff ss
     JOIN staff st ON ss.staff_id = st.id
     WHERE ss.schedule_id = $1 ORDER BY st.name`,
    [scheduleId]
  );

  return {
    id: row.id,
    date: row.date,
    start_time: row.start_time,
    end_time: row.end_time,
    duration_minutes: row.duration_minutes,
    timezone: row.timezone,
    service_type: { id: row.service_type_id, name: row.service_type_name },
    service_name: { id: row.service_name_id, name: row.service_name_name },
    room_type:    { id: row.room_type_id, name: row.room_type_name },
    room_name:    { id: row.room_name_id, name: row.room_name_name, capacity: row.room_capacity },
    staffs: staffResult.rows,
  };
};

/**
 * Helper: tandai jadwal yang sudah lewat sebagai hidden
 * Dipanggil otomatis saat fetch jadwal
 */
const _archiveExpiredSchedules = async (branchId) => {
  // Hanya archive jadwal yang tidak punya booking pending/checked_in
  await pool.query(
    `UPDATE schedule
     SET hidden_at = NOW()
     WHERE hidden_at IS NULL
       AND branch_id = $1
       AND (
         date < CURRENT_DATE
         OR (date = CURRENT_DATE AND end_time <= CURRENT_TIME)
       )
       AND NOT EXISTS (
         SELECT 1 FROM booking b
         WHERE b.schedule_id = schedule.id
           AND b.status IN ('pending', 'checked_in')
       )`,
    [branchId]
  );
};

const getSchedules = async (req, res) => {
  // 1. Validasi branchId dari object admin
  // Menggunakan optional chaining (?.) untuk menghindari error jika req.admin undefined
  const branchId = req.admin?.branch_id; 
  if (!branchId) {
    return res.status(403).json({ success: false, message: "No branch" });
  }

  // 2. Validasi query parameter
  const { service_name_id, date } = req.query;
  if (!service_name_id || !date) {
    return res.status(400).json({
      success: false,
      message: "Query param service_name_id dan date wajib disertakan",
    });
  }

  try {
    // 3. Auto-archive jadwal lama
    // Diletakkan di dalam try-catch agar jika query gagal, tidak menyebabkan server crash
    await _archiveExpiredSchedules(branchId);

    // 4. Fetch jadwal aktif dengan tambahan filter AND s.hidden_at IS NULL
    const result = await pool.query(
      `SELECT
         s.id,
         TO_CHAR(s.date, 'YYYY-MM-DD')    AS date,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
         TO_CHAR(s.end_time, 'HH24:MI')   AS end_time,
         s.duration_minutes, s.timezone,
         st.id AS service_type_id, st.name AS service_type_name,
         sn.id AS service_name_id, sn.name AS service_name_name,
         rt.id AS room_type_id,    rt.name AS room_type_name,
         rn.id AS room_name_id,    rn.name AS room_name_name,
         rn.capacity AS room_capacity
       FROM schedule s
       JOIN service_type st ON s.service_type_id = st.id
       JOIN service_name sn ON s.service_name_id = sn.id
       JOIN room_type rt    ON s.room_type_id = rt.id
       JOIN room_name rn    ON s.room_name_id = rn.id
       WHERE s.branch_id = $1
         AND s.service_name_id = $2
         AND s.date = $3::date
         AND s.hidden_at IS NULL
       ORDER BY s.start_time ASC`,
      [branchId, service_name_id, date]
    );

    // 5. Fetch staff untuk masing-masing jadwal
    const schedules = await Promise.all(
      result.rows.map(async (row) => {
        const staffResult = await pool.query(
          `SELECT st.id, st.name FROM schedule_staff ss
           JOIN staff st ON ss.staff_id = st.id
           WHERE ss.schedule_id = $1 ORDER BY st.name`,
          [row.id]
        );
        return {
          id: row.id,
          date: row.date,
          start_time: row.start_time,
          end_time: row.end_time,
          duration_minutes: row.duration_minutes,
          timezone: row.timezone,
          service_type: { id: row.service_type_id, name: row.service_type_name },
          service_name: { id: row.service_name_id, name: row.service_name_name },
          room_type:    { id: row.room_type_id, name: row.room_type_name },
          room_name:    { id: row.room_name_id, name: row.room_name_name, capacity: row.room_capacity },
          staffs: staffResult.rows,
        };
      })
    );

    return res.status(200).json({ success: true, data: schedules });
  } catch (err) {
    console.error("Get schedules error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createSchedule = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const {
    service_type_id, service_name_id,
    room_type_id, room_name_id,
    date, start_time, end_time,
    timezone = "WIB",
    staff_ids = [],
  } = req.body;

  if (!service_type_id || !service_name_id || !room_type_id || !room_name_id) {
    return res.status(400).json({ success: false, message: "Service dan ruangan wajib dipilih" });
  }
  if (!date || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: "Tanggal dan waktu wajib diisi" });
  }

  const [sh, sm] = start_time.split(":").map(Number);
  const [eh, em] = end_time.split(":").map(Number);
  const duration_minutes = eh * 60 + em - (sh * 60 + sm);
  if (duration_minutes <= 0) {
    return res.status(400).json({ success: false, message: "Waktu selesai harus lebih besar dari waktu mulai" });
  }

  const now = new Date();
const schedStart = new Date(`${date}T${start_time}:00`);
if (schedStart <= now) {
  return res.status(400).json({
    success: false,
    message: "Tidak bisa membuat jadwal di waktu yang sudah berlalu",
  });
}

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const clashes = await detectClashes(client, branchId, {
      date, start_time, end_time, room_name_id, staff_ids,
    });
    if (clashes.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Terdapat bentrok jadwal", clashes });
    }

    const roomResult = await client.query(
      `SELECT capacity FROM room_name WHERE id = $1 AND branch_id = $2`,
      [room_name_id, branchId]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Ruangan tidak ditemukan atau tidak valid" });
    }
    
    const slotCount = roomResult.rows[0].capacity;
    
    const result = await client.query(
      `INSERT INTO schedule
         (branch_id, service_type_id, service_name_id, room_type_id, room_name_id,
          date, start_time, end_time, duration_minutes, timezone, slot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        branchId, service_type_id, service_name_id, room_type_id, room_name_id,
        date, start_time, end_time, duration_minutes, timezone, slotCount
      ]
    );
    const newId = result.rows[0].id;

    // Insert staff
    if (staff_ids.length > 0) {
      const vals = staff_ids.map((sid) => `(${newId}, ${sid})`).join(", ");
      await client.query(`INSERT INTO schedule_staff (schedule_id, staff_id) VALUES ${vals}`);
    }

    await client.query("COMMIT");

    const newSchedule = await fetchScheduleById(newId);
    return res.status(201).json({
      success: true,
      message: "Jadwal berhasil ditambahkan",
      data: newSchedule,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create schedule error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// PUT /api/schedules/:id
const updateSchedule = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const scheduleId = parseInt(req.params.id);
  if (isNaN(scheduleId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  const {
    service_type_id, service_name_id,
    room_type_id, room_name_id,
    date, start_time, end_time,
    timezone = "WIB",
    staff_ids = [],
  } = req.body;

  if (!date || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: "Tanggal dan waktu wajib diisi" });
  }

  const [sh, sm] = start_time.split(":").map(Number);
  const [eh, em] = end_time.split(":").map(Number);
  const duration_minutes = eh * 60 + em - (sh * 60 + sm);
  if (duration_minutes <= 0) {
    return res.status(400).json({ success: false, message: "Waktu selesai harus lebih besar dari waktu mulai" });
  }

  const now = new Date();
const schedStart = new Date(`${date}T${start_time}:00`);
if (schedStart <= now) {
  return res.status(400).json({
    success: false,
    message: "Tidak bisa membuat jadwal di waktu yang sudah berlalu",
  });
}

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cek ownership
    const check = await client.query(
      `SELECT id FROM schedule WHERE id = $1 AND branch_id = $2`,
      [scheduleId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Jadwal tidak ditemukan" });
    }

    // Cek bentrok (exclude diri sendiri)
    const clashes = await detectClashes(client, branchId, {
      date, start_time, end_time, room_name_id, staff_ids,
    }, scheduleId);

    if (clashes.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Terdapat bentrok jadwal", clashes });
    }

    // Update
    await client.query(
      `UPDATE schedule
       SET service_type_id=$1, service_name_id=$2, room_type_id=$3, room_name_id=$4,
           date=$5, start_time=$6, end_time=$7, duration_minutes=$8, timezone=$9, updated_at=NOW()
       WHERE id=$10`,
      [service_type_id, service_name_id, room_type_id, room_name_id,
       date, start_time, end_time, duration_minutes, timezone, scheduleId]
    );

    // Replace staff
    await client.query(`DELETE FROM schedule_staff WHERE schedule_id = $1`, [scheduleId]);
    if (staff_ids.length > 0) {
      const vals = staff_ids.map((sid) => `(${scheduleId}, ${sid})`).join(", ");
      await client.query(`INSERT INTO schedule_staff (schedule_id, staff_id) VALUES ${vals}`);
    }

    await client.query("COMMIT");

    const updated = await fetchScheduleById(scheduleId);
    return res.status(200).json({ success: true, message: "Jadwal berhasil diperbarui", data: updated });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update schedule error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// DELETE /api/schedules/:id
const deleteSchedule = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const scheduleId = parseInt(req.params.id);
  if (isNaN(scheduleId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM schedule WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [scheduleId, branchId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Jadwal tidak ditemukan" });
    }
    return res.status(200).json({ success: true, message: "Jadwal berhasil dihapus" });
  } catch (err) {
    console.error("Delete schedule error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/schedules/copy
const copySchedules = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const { source_date, target_date, service_name_id } = req.body;

  if (!source_date || !target_date || !service_name_id) {
    return res.status(400).json({
      success: false,
      message: "source_date, target_date, dan service_name_id wajib diisi",
    });
  }

  const now = new Date();
const schedStart = new Date(`${date}T${start_time}:00`);
if (schedStart <= now) {
  return res.status(400).json({
    success: false,
    message: "Tidak bisa membuat jadwal di waktu yang sudah berlalu",
  });
}
  if (source_date === target_date) {
    return res.status(400).json({ success: false, message: "Tanggal tujuan tidak boleh sama dengan tanggal asal" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ambil semua jadwal source
    const sourceResult = await client.query(
      `SELECT s.id, s.service_type_id, s.service_name_id, s.room_type_id, s.room_name_id,
              TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
              TO_CHAR(s.end_time, 'HH24:MI') AS end_time,
              s.duration_minutes, s.timezone
       FROM schedule s
       WHERE s.branch_id = $1 AND s.service_name_id = $2 AND s.date = $3::date
       ORDER BY s.start_time ASC`,
      [branchId, service_name_id, source_date]
    );

    if (sourceResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Tidak ada jadwal di tanggal asal" });
    }

    // Ambil staff untuk setiap jadwal source
    const sourcesWithStaff = await Promise.all(
      sourceResult.rows.map(async (s) => {
        const staffRes = await client.query(
          `SELECT staff_id FROM schedule_staff WHERE schedule_id = $1`,
          [s.id]
        );
        return { ...s, staff_ids: staffRes.rows.map((r) => r.staff_id) };
      })
    );

    // Cek bentrok untuk semua jadwal yang akan disalin
    const copyClashes = [];
    for (const sch of sourcesWithStaff) {
      const clashes = await detectClashes(client, branchId, {
        date: target_date,
        start_time: sch.start_time,
        end_time: sch.end_time,
        room_name_id: sch.room_name_id,
        staff_ids: sch.staff_ids,
      });
      if (clashes.length > 0) {
        copyClashes.push({
          schedule: `${sch.start_time} – ${sch.end_time}`,
          clashes,
        });
      }
    }

    if (copyClashes.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Terdapat bentrok jadwal saat penyalinan",
        copy_clashes: copyClashes,
      });
    }

    // Insert semua jadwal baru
    let copiedCount = 0;
    for (const sch of sourcesWithStaff) {
      const insertResult = await client.query(
        `INSERT INTO schedule
           (branch_id, service_type_id, service_name_id, room_type_id, room_name_id,
            date, start_time, end_time, duration_minutes, timezone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [branchId, sch.service_type_id, sch.service_name_id, sch.room_type_id, sch.room_name_id,
         target_date, sch.start_time, sch.end_time, sch.duration_minutes, sch.timezone]
      );
      const newId = insertResult.rows[0].id;
      copiedCount++;

      if (sch.staff_ids.length > 0) {
        const vals = sch.staff_ids.map((sid) => `(${newId}, ${sid})`).join(", ");
        await client.query(`INSERT INTO schedule_staff (schedule_id, staff_id) VALUES ${vals}`);
      }
    }

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: `${copiedCount} jadwal berhasil disalin ke ${target_date}`,
      data: { copied_count: copiedCount, target_date },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Copy schedules error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = { getSchedules, createSchedule, updateSchedule, deleteSchedule, copySchedules };