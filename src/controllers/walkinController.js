const pool = require("../config/db");

// Helper: hitung total penggunaan slot (booking + walkin) untuk satu schedule
const countScheduleUsage = async (client, scheduleId, serviceNameId, roomNameId, date, startTime, endTime) => {
  const bookings = await client.query(
    `SELECT COUNT(*) FROM booking WHERE schedule_id = $1 AND status NOT IN ('cancelled')`,
    [scheduleId]
  );
  const walkins = await client.query(
    `SELECT COUNT(*) FROM walkin_booking
     WHERE service_name_id = $1 AND room_name_id = $2
       AND date = $3::date
       AND start_time < $4::time AND end_time > $5::time
       AND hidden_at IS NULL`,
    [serviceNameId, roomNameId, date, endTime, startTime]
  );
  return parseInt(bookings.rows[0].count) + parseInt(walkins.rows[0].count);
};

/**
 * GET /api/admin/walkin?date=YYYY-MM-DD
 */
const getWalkinList = async (req, res) => {
  const branchId = req.admin.branch_id;
  if (!branchId) return res.status(403).json({ success: false, message: "No branch" });

  const date = req.query.date || new Date().toISOString().split("T")[0];

  try {
    const result = await pool.query(
      `SELECT
         wb.id, wb.customer_name, wb.customer_email,
         TO_CHAR(wb.date, 'YYYY-MM-DD') AS date,
         TO_CHAR(wb.start_time, 'HH24:MI') AS start_time,
         TO_CHAR(wb.end_time, 'HH24:MI') AS end_time,
         wb.duration_minutes, wb.notes, wb.created_at,
         st.name AS service_type_name,
         sn.name AS service_name_name,
         rt.name AS room_type_name,
         rn.name AS room_name_name,
         a.email AS admin_email
       FROM walkin_booking wb
       LEFT JOIN service_type st ON wb.service_type_id = st.id
       LEFT JOIN service_name sn  ON wb.service_name_id = sn.id
       LEFT JOIN room_type rt     ON wb.room_type_id = rt.id
       LEFT JOIN room_name rn     ON wb.room_name_id = rn.id
       LEFT JOIN admin a          ON wb.admin_id = a.id
       WHERE wb.branch_id = $1 AND wb.hidden_at IS NULL AND wb.date = $2::date
       ORDER BY wb.start_time ASC`,
      [branchId, date]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get walkin list error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/admin/walkin
 * Submit walk-in: validasi + buat sekaligus
 * Body: { customer_name, email, service_type_id, service_name_id,
 *         room_type_id, room_name_id, date, start_time, end_time, notes }
 */
const createWalkin = async (req, res) => {
  const adminId  = req.admin.id;
  const branchId = req.admin.branch_id;
  if (!branchId) return res.status(403).json({ success: false, message: "No branch" });

  const {
    customer_name, email,
    service_type_id, service_name_id,
    room_type_id, room_name_id,
    date, start_time, end_time, notes,
  } = req.body;

  if (!customer_name || !service_name_id || !room_name_id || !date || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: "Field wajib: nama, service, room, tanggal, waktu" });
  }

  const [sh, sm] = start_time.split(":").map(Number);
  const [eh, em] = end_time.split(":").map(Number);
  const duration_minutes = eh * 60 + em - (sh * 60 + sm);
  if (duration_minutes <= 0) {
    return res.status(400).json({ success: false, message: "Waktu selesai harus lebih besar dari waktu mulai" });
  }

  // Tidak boleh walk-in untuk waktu yang sudah lewat
  const now = new Date();
  const reqStart = new Date(`${date}T${start_time}:00+07:00`);
  if (reqStart < now) {
    return res.status(400).json({ success: false, message: "Tidak bisa membuat walk-in untuk waktu yang sudah berlalu" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ─── 1. Cek user & membership ──────────────────────────────
    let userId = null;
    if (email && email.trim()) {
      const userResult = await client.query(
        `SELECT id, name, email FROM app_user WHERE email = $1 LIMIT 1`,
        [email.toLowerCase().trim()]
      );
      if (userResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Email tidak terdaftar di sistem",
          error_code: "USER_NOT_FOUND",
        });
      }
      userId = userResult.rows[0].id;

      const membershipCheck = await client.query(
        `SELECT um.id, m.name AS membership_name
         FROM user_membership um
         JOIN membership m ON um.membership_id = m.id
         JOIN membership_benefit mb ON mb.membership_id = m.id
         WHERE um.user_id = $1 AND um.branch_id = $2
           AND um.status = 'active' AND um.expire_date >= CURRENT_DATE
           AND mb.service_name_id = $3
         LIMIT 1`,
        [userId, branchId, service_name_id]
      );
      if (membershipCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          success: false,
          message: `User "${userResult.rows[0].name}" tidak memiliki membership aktif dengan akses ke layanan ini`,
          error_code: "NO_MEMBERSHIP_ACCESS",
        });
      }

      // Cek konflik jadwal user
      const conflictBooking = await client.query(
        `SELECT b.id FROM booking b JOIN schedule s ON b.schedule_id = s.id
         WHERE b.user_id = $1 AND b.status NOT IN ('cancelled')
           AND s.date = $2::date
           AND s.start_time < $3::time AND s.end_time > $4::time`,
        [userId, date, end_time, start_time]
      );
      const conflictWalkin = await client.query(
        `SELECT id FROM walkin_booking
         WHERE user_id = $1 AND date = $2::date
           AND start_time < $3::time AND end_time > $4::time
           AND hidden_at IS NULL`,
        [userId, date, end_time, start_time]
      );
      if (conflictBooking.rows.length > 0 || conflictWalkin.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "User sudah memiliki booking lain di waktu yang sama",
          error_code: "USER_CONFLICT",
        });
      }
    }

    // ─── 2. Cek overlapping schedules & slot ───────────────────
    const overlapResult = await client.query(
      `SELECT
         s.id, s.slot AS total_slots,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_str,
         TO_CHAR(s.end_time, 'HH24:MI')   AS end_str,
         s.service_name_id, s.room_name_id
       FROM schedule s
       WHERE s.branch_id = $1
         AND s.service_name_id = $2
         AND s.room_name_id = $3
         AND s.date = $4::date
         AND s.start_time < $5::time
         AND s.end_time > $6::time
         AND s.hidden_at IS NULL`,
      [branchId, service_name_id, room_name_id, date, end_time, start_time]
    );

    // Untuk setiap overlapping schedule, cek apakah masih ada slot
    const fullSchedules = [];
    for (const sch of overlapResult.rows) {
      const used = await countScheduleUsage(
        client, sch.id, sch.service_name_id, sch.room_name_id,
        date, sch.start_str, sch.end_str
      );
      if (used >= sch.total_slots) {
        // Ambil siapa yang sudah booking
        const bookers = await client.query(
          `SELECT au.name AS customer_name, au.email AS customer_email, 'booking' AS source
           FROM booking b JOIN app_user au ON b.user_id = au.id
           WHERE b.schedule_id = $1 AND b.status NOT IN ('cancelled')
           UNION ALL
           SELECT wb.customer_name, wb.customer_email, 'walkin' AS source
           FROM walkin_booking wb
           WHERE wb.service_name_id = $2 AND wb.room_name_id = $3
             AND wb.date = $4::date
             AND wb.start_time < $5::time AND wb.end_time > $6::time
             AND wb.hidden_at IS NULL`,
          [sch.id, sch.service_name_id, sch.room_name_id,
           date, sch.end_str, sch.start_str]
        );
        fullSchedules.push({
          schedule_time: `${sch.start_str} – ${sch.end_str}`,
          total_slots: sch.total_slots,
          bookers: bookers.rows,
        });
      }
    }

    if (fullSchedules.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Slot sudah penuh pada salah satu jadwal yang overlap",
        error_code: "SLOT_FULL",
        conflicting_schedules: fullSchedules,
      });
    }

    // ─── 3. Buat walkin_booking ────────────────────────────────
    const insertResult = await client.query(
      `INSERT INTO walkin_booking
         (branch_id, admin_id, user_id, service_type_id, service_name_id,
          room_type_id, room_name_id, customer_name, customer_email,
          date, start_time, end_time, duration_minutes, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, customer_name`,
      [
        branchId, adminId, userId,
        service_type_id || null, service_name_id,
        room_type_id || null, room_name_id,
        customer_name.trim(), email?.toLowerCase().trim() || null,
        date, start_time, end_time, duration_minutes, notes || null,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: `Walk-in untuk "${customer_name}" berhasil didaftarkan`,
      data: insertResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create walkin error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/admin/walkin/:id
 */
const deleteWalkin = async (req, res) => {
  const branchId = req.admin.branch_id;
  const walkinId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE walkin_booking SET hidden_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND hidden_at IS NULL
       RETURNING customer_name`,
      [walkinId, branchId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Walk-in tidak ditemukan" });
    }
    return res.status(200).json({ success: true, message: `Walk-in "${result.rows[0].customer_name}" dihapus` });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getWalkinList, createWalkin, deleteWalkin };