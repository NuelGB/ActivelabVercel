const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const genCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

const genQrToken = (payload, expiresAt) => {
  const secondsUntilExpiry = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  // Pastikan minimal 60 detik agar jwt.sign tidak menerima nilai 0/negatif
  const safeExpiry = secondsUntilExpiry > 0 ? secondsUntilExpiry : 60;
  return jwt.sign(payload, process.env.BOOKING_QR_SECRET, { expiresIn: safeExpiry });
};

const createBooking = async (req, res) => {
  const userId = req.user.id;
  const { schedule_id } = req.body;

  if (!schedule_id) {
    return res.status(400).json({ success: false, message: "schedule_id wajib diisi" });
  }

  const client = await pool.connect();

  try {
    const schedResult = await client.query(
      `SELECT s.*, b.address AS branch_address,
          TO_CHAR(s.date, 'YYYY-MM-DD') AS date_str,
          TO_CHAR(s.start_time, 'HH24:MI') AS start_str,
          TO_CHAR(s.end_time, 'HH24:MI')   AS end_str
       FROM schedule s
       JOIN branch b ON s.branch_id = b.id
       WHERE s.id = $1`,
      [schedule_id]
    );

    if (schedResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Jadwal tidak ditemukan" });
    }

    const sch = schedResult.rows[0];

    // 🌟 PENTING: data date/time di DB disimpan sebagai waktu WIB (UTC+7).
    // Tambahkan offset "+07:00" secara eksplisit supaya hasil Date object
    // selalu benar TANPA tergantung pada zona waktu server (Railway dll).
    const schedStart = new Date(`${sch.date_str}T${sch.start_str}:00+07:00`);
    const schedEnd = new Date(`${sch.date_str}T${sch.end_str}:00+07:00`);
    const now = new Date();
    const Limittime = new Date(now.getTime() + 1 * 60 * 1000);

    if (schedStart < Limittime) {
      return res.status(400).json({
        success: false,
        message: "Jadwal ini sudah tidak bisa di-booking (kurang dari 1 menit lagi)",
      });
    }

    const bookedCount = await client.query(
      `SELECT COUNT(*) FROM booking WHERE schedule_id = $1 AND status NOT IN ('cancelled')`,
      [schedule_id]
    );

    const walkinCount = await client.query(
      `SELECT COUNT(*) FROM walkin_booking
       WHERE service_name_id = $1 AND room_name_id = $2
         AND date = $3::date
         AND start_time < $4::time AND end_time > $5::time
         AND hidden_at IS NULL`,
      [sch.service_name_id, sch.room_name_id, sch.date_str, sch.end_str, sch.start_str]
    );

    const totalUsed = parseInt(bookedCount.rows[0].count) + parseInt(walkinCount.rows[0].count);

    if (totalUsed >= sch.slot) {
      return res.status(400).json({ success: false, message: "Jadwal ini sudah penuh" });
    }

    const membershipCheck = await client.query(
      `SELECT um.id FROM user_membership um
       JOIN membership m ON um.membership_id = m.id
       JOIN membership_benefit mb ON mb.membership_id = m.id
       WHERE um.user_id = $1
         AND um.branch_id = $2
         AND um.status = 'active'
         AND um.expire_date >= CURRENT_DATE
         AND mb.service_name_id = $3
       LIMIT 1`,
      [userId, sch.branch_id, sch.service_name_id]
    );

    if (membershipCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Anda tidak memiliki membership aktif dengan akses ke layanan ini di cabang ini",
        error_code: "NO_MEMBERSHIP",
      });
    }

    const conflictCheck = await client.query(
      `SELECT b.id FROM booking b
       JOIN schedule s ON b.schedule_id = s.id
       WHERE b.user_id = $1
         AND b.status NOT IN ('cancelled')
         AND s.date = $2::date
         AND s.start_time < $3::time
         AND s.end_time > $4::time`,
      [userId, sch.date_str, sch.end_str, sch.start_str]
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Anda sudah memiliki booking lain di waktu yang sama",
        error_code: "SCHEDULE_CONFLICT",
      });
    }

    // ─── Mulai transaction HANYA untuk bagian write (INSERT + UPDATE) ───
    await client.query("BEGIN");

    const checkinCode = genCode();
    const checkinQrExpiry = schedEnd;

    const bookingResult = await client.query(
      `INSERT INTO booking (user_id, schedule_id, branch_id, status, checkin_code, checkin_qr_expires_at)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING id`,
      [userId, schedule_id, sch.branch_id, checkinCode, checkinQrExpiry]
    );

    const bookingId = bookingResult.rows[0].id;

    const checkinQrToken = genQrToken(
      {
        booking_id: bookingId,
        user_id: userId,
        schedule_id: sch.id,
        branch_id: sch.branch_id,
        type: "checkin",
        code: checkinCode,
      },
      checkinQrExpiry
    );

    await client.query(
      `UPDATE booking SET checkin_qr_token = $1 WHERE id = $2`,
      [checkinQrToken, bookingId]
    );

    await client.query("COMMIT");

    const booking = await _getBookingById(bookingId);

    return res.status(201).json({
      success: true,
      message: "Booking berhasil dibuat!",
      data: booking,
    });
  } catch (err) {
    // Kalau transaction sudah BEGIN tapi gagal di tengah jalan, ROLLBACK
    // supaya tidak ada row "pending" yang nyangkut tanpa checkin_qr_token.
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore jika belum BEGIN */
    }
    console.error("Create booking error:", err); // log lengkap (termasuk stack)
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

const getUserBookings = async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query(
      `UPDATE booking SET status = 'cancelled', updated_at = NOW()
       WHERE user_id = $1 AND status = 'pending'
         AND checkin_qr_expires_at < NOW()`,
      [userId]
    );

    await pool.query(
      `UPDATE booking SET status = 'checked_out', checkout_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND status = 'checked_in'
         AND checkout_qr_expires_at IS NOT NULL
         AND checkout_qr_expires_at < NOW()`,
      [userId]
    );

    const result = await pool.query(
      `SELECT id FROM booking
       WHERE user_id = $1
         AND status IN ('pending', 'checked_in')
         AND hidden_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );

    const bookings = await Promise.all(
      result.rows.map((r) => _getBookingById(r.id))
    );

    return res.status(200).json({ success: true, data: bookings });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getBookingHistory = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT id FROM booking
       WHERE user_id = $1
         AND status IN ('checked_out', 'cancelled')
         AND hidden_at IS NULL
       ORDER BY updated_at DESC`,
      [userId]
    );

    const bookings = await Promise.all(
      result.rows.map((r) => _getBookingById(r.id))
    );

    return res.status(200).json({ success: true, data: bookings });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const cancelBooking = async (req, res) => {
  const userId = req.user.id;
  const bookingId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE booking SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
      [bookingId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking tidak ditemukan atau sudah tidak bisa dibatalkan" });
    }

    return res.status(200).json({ success: true, message: "Booking berhasil dibatalkan" });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getBookingById = async (req, res) => {
  const userId = req.user.id;
  const bookingId = parseInt(req.params.id);
  try {
    const booking = await _getBookingById(bookingId);
    if (!booking || booking.user_id !== userId) {
      return res.status(404).json({ success: false, message: "Booking tidak ditemukan" });
    }
    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const hideBooking = async (req, res) => {
  const userId = req.user.id;
  const bookingId = parseInt(req.params.id);
  try {
    await pool.query(
      `UPDATE booking SET hidden_at = NOW() WHERE id = $1 AND user_id = $2`,
      [bookingId, userId]
    );
    return res.status(200).json({ success: true, message: "Berhasil dihapus dari history" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getCheckinCode = async (req, res) => {
  const userId = req.user.id;
  const bookingId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `SELECT b.checkin_code, b.checkin_qr_expires_at, b.status,
              TO_CHAR(s.start_time, 'HH24:MI') AS start_str,
              TO_CHAR(s.date, 'YYYY-MM-DD') AS date_str
       FROM booking b JOIN schedule s ON b.schedule_id = s.id
       WHERE b.id = $1 AND b.user_id = $2 AND b.status = 'pending'`,
      [bookingId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking tidak ditemukan" });
    }
    const booking = result.rows[0];
    const now = new Date();
    // 🌟 Tambahkan offset +07:00 (WIB) — data date/time di DB disimpan dalam WIB
    const schedStart = new Date(`${booking.date_str}T${booking.start_str}:00+07:00`);
 
    if (now < schedStart) {
      return res.status(400).json({
        success: false,
        message: `Sesi belum dimulai. Check-in bisa dilakukan mulai ${booking.start_str}`,
      });
    }
    if (now > new Date(booking.checkin_qr_expires_at)) {
      return res.status(400).json({ success: false, message: "Waktu check-in sudah habis" });
    }
 
    return res.status(200).json({
      success: true,
      data: {
        checkin_code: booking.checkin_code,
        expires_at: booking.checkin_qr_expires_at,
      },
    });
  } catch (err) {
    console.error("Get checkin code error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getCheckoutCode = async (req, res) => {
  const userId = req.user.id;
  const bookingId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `SELECT b.checkout_code, b.checkout_qr_expires_at, b.checkin_at,
              b.branch_id, b.schedule_id,
              TO_CHAR(s.date, 'YYYY-MM-DD') AS date_str,
              TO_CHAR(s.end_time, 'HH24:MI') AS end_str
       FROM booking b JOIN schedule s ON b.schedule_id = s.id
       WHERE b.id = $1 AND b.user_id = $2 AND b.status = 'checked_in'`,
      [bookingId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking belum check-in" });
    }
    const booking = result.rows[0];
 
    if (!booking.checkout_code) {
      const checkoutCode = genCode();
      // 🌟 Tambahkan offset +07:00 (WIB) saat menghitung waktu expired checkout
      const checkoutExpiry = new Date(
        new Date(`${booking.date_str}T${booking.end_str}:00+07:00`).getTime() + 60 * 60 * 1000
      );
      await pool.query(
        `UPDATE booking SET checkout_code = $1, checkout_qr_expires_at = $2 WHERE id = $3`,
        [checkoutCode, checkoutExpiry, bookingId]
      );
      return res.status(200).json({
        success: true,
        data: { checkout_code: checkoutCode, expires_at: checkoutExpiry },
      });
    }
 
    if (new Date() > new Date(booking.checkout_qr_expires_at)) {
      return res.status(400).json({ success: false, message: "Waktu check-out sudah habis" });
    }
 
    return res.status(200).json({
      success: true,
      data: {
        checkout_code: booking.checkout_code,
        expires_at: booking.checkout_qr_expires_at,
      },
    });
  } catch (err) {
    console.error("Get checkout code error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

async function _getBookingById(bookingId) {
  const result = await pool.query(
    `SELECT b.*,
       TO_CHAR(s.date,'YYYY-MM-DD') AS sched_date,
       TO_CHAR(s.start_time,'HH24:MI') AS sched_start,
       TO_CHAR(s.end_time,'HH24:MI')   AS sched_end,
       s.duration_minutes, s.timezone, s.slot AS total_slots,
       st.name AS service_type_name, sn.name AS service_name_name,
       rt.name AS room_type_name, rn.name AS room_name_name,
       br.name AS branch_name, br.address AS branch_address, br.photo AS branch_photo,
       u.name AS user_name, u.email AS user_email
     FROM booking b
     JOIN schedule s   ON b.schedule_id = s.id
     JOIN service_type st ON s.service_type_id = st.id
     JOIN service_name sn ON s.service_name_id = sn.id
     JOIN room_type rt    ON s.room_type_id = rt.id
     JOIN room_name rn    ON s.room_name_id = rn.id
     JOIN branch br    ON b.branch_id = br.id
     JOIN app_user u   ON b.user_id = u.id
     WHERE b.id = $1`,
    [bookingId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];

  const staffResult = await pool.query(
    `SELECT st.id, st.name FROM schedule_staff ss
     JOIN staff st ON ss.staff_id = st.id
     WHERE ss.schedule_id = $1`,
    [r.schedule_id]
  );

  return {
    id: r.id,
    user_id: r.user_id,
    status: r.status,
    created_at: r.created_at,
    checkin_at: r.checkin_at,
    checkout_at: r.checkout_at,
    checkin_qr_expires_at: r.checkin_qr_expires_at,
    checkout_qr_expires_at: r.checkout_qr_expires_at,
    schedule: {
      id: r.schedule_id,
      date: r.sched_date,
      start_time: r.sched_start,
      end_time: r.sched_end,
      duration_minutes: r.duration_minutes,
      timezone: r.timezone,
      total_slots: r.total_slots,
      service_type_name: r.service_type_name,
      service_name_name: r.service_name_name,
      room_type_name: r.room_type_name,
      room_name_name: r.room_name_name,
      staffs: staffResult.rows,
    },
    branch: {
      name: r.branch_name,
      address: r.branch_address,
      photo: r.branch_photo,
    },
    user: { name: r.user_name, email: r.user_email },
  };
}

module.exports = {
  createBooking, getUserBookings, getBookingHistory,
  cancelBooking, getBookingById, hideBooking,
  getCheckinCode,
  getCheckoutCode,
};