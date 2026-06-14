const pool = require("../config/db");

/**
 * POST /api/admin/scan/process
 */
const processScan = async (req, res) => {
  const adminId = req.admin.id;
  const branchId = req.admin.branch_id;
  const { code, scan_type } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: "Kode wajib diisi" });
  }
  if (!["checkin", "checkout"].includes(scan_type)) {
    return res.status(400).json({ success: false, message: "scan_type tidak valid" });
  }

  try {
    const codeField = scan_type === "checkin" ? "checkin_code" : "checkout_code";
    const bookingResult = await pool.query(
      `SELECT id FROM booking WHERE ${codeField} = $1 AND branch_id = $2 LIMIT 1`,
      [code.trim().toUpperCase(), branchId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Kode tidak ditemukan atau bukan milik cabang ini",
      });
    }

    const bookingData = await _processBookingAction(
      bookingResult.rows[0].id,
      scan_type,
      adminId,
      branchId
    );

    return res.status(200).json({ success: true, data: bookingData });
  } catch (err) {
    console.error("Process scan error:", err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── Helper: Proses check-in atau check-out ───────────────────
// ─── Helper: Proses check-in atau check-out ───────────────────
async function _processBookingAction(bookingId, scanType, adminId, branchId) {
  const booking = await pool.query(
    `SELECT b.*, s.date, TO_CHAR(s.start_time,'HH24:MI') AS start_str,
             TO_CHAR(s.end_time,'HH24:MI') AS end_str,
             TO_CHAR(s.date,'YYYY-MM-DD') AS date_str
     FROM booking b JOIN schedule s ON b.schedule_id = s.id
     WHERE b.id = $1 AND b.branch_id = $2`,
    [bookingId, branchId]
  );

  if (booking.rows.length === 0) throw new Error("Booking tidak ditemukan di cabang ini");

  const b = booking.rows[0];
  const now = new Date();

  if (scanType === "checkin") {
    if (b.status !== "pending") {
      throw new Error(
        b.status === "checked_in"
          ? "User sudah check-in"
          : `Status booking: ${b.status}`
      );
    }

    // 🌟 Tambahkan offset +07:00 (WIB) — data date/time di DB disimpan dalam WIB
    const schedStart = new Date(`${b.date_str}T${b.start_str}:00+07:00`);
    const schedEnd = new Date(`${b.date_str}T${b.end_str}:00+07:00`);

    if (now < schedStart) throw new Error(`Sesi belum dimulai. Mulai: ${b.start_str}`);
    if (now > schedEnd) throw new Error("Sesi sudah berakhir. Waktu check-in expired.");

    await pool.query(
      `UPDATE booking SET status = 'checked_in', checkin_at = NOW(), checkin_admin_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [adminId, bookingId]
    );

  } else if (scanType === "checkout") {
    if (b.status !== "checked_in") {
      throw new Error(b.status === "pending" ? "User belum check-in" : `Status: ${b.status}`);
    }

    // 🌟 Tambahkan offset +07:00 (WIB)
    const schedEnd = new Date(`${b.date_str}T${b.end_str}:00+07:00`);
    const checkoutDeadline = new Date(schedEnd.getTime() + 60 * 60 * 1000);

    if (now > checkoutDeadline) throw new Error("Waktu check-out sudah expired (lebih dari 1 jam setelah sesi selesai)");

    await pool.query(
      `UPDATE booking SET status = 'checked_out', checkout_at = NOW(), checkout_admin_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [adminId, bookingId]
    );
  }

  // Ambil data lengkap untuk response ke admin
  const updatedResult = await pool.query(
    `SELECT b.id, b.status, b.checkin_at, b.checkout_at,
       u.name AS user_name, u.email AS user_email,
       TO_CHAR(s.date,'YYYY-MM-DD') AS sched_date,
       TO_CHAR(s.start_time,'HH24:MI') AS sched_start,
       TO_CHAR(s.end_time,'HH24:MI') AS sched_end,
       st.name AS service_type_name, sn.name AS service_name_name,
       rn.name AS room_name
     FROM booking b
     JOIN app_user u ON b.user_id = u.id
     JOIN schedule s ON b.schedule_id = s.id
     JOIN service_type st ON s.service_type_id = st.id
     JOIN service_name sn ON s.service_name_id = sn.id
     JOIN room_name rn ON s.room_name_id = rn.id
     WHERE b.id = $1`,
    [bookingId]
  );

  return updatedResult.rows[0];
}

module.exports = { processScan };