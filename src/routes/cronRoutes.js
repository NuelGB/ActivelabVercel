const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { createNotification } = require("../controllers/notificationController");

router.get("/booking-reminder", async (req, res) => {
  // Verifikasi Secret Key dari Vercel Cron
  if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: "Unauthorized access" });
  }

  try {
    const result = await pool.query(
      `SELECT
         b.id AS booking_id, b.user_id,
         sn.name AS service_name,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
         s.timezone
       FROM booking b
       JOIN schedule s  ON b.schedule_id = s.id
       JOIN service_name sn ON s.service_name_id = sn.id
       WHERE b.status = 'pending'
         AND s.date = CURRENT_DATE
         AND (s.start_time - INTERVAL '10 minutes') <= CURRENT_TIME
         AND s.start_time > CURRENT_TIME
         AND NOT EXISTS (
           SELECT 1 FROM user_notification un
           WHERE un.user_id = b.user_id
             AND un.type = 'booking_reminder'
             AND (un.data->>'booking_id')::int = b.id
         )`
    );

    for (const row of result.rows) {
      await createNotification(
        row.user_id,
        "booking_reminder",
        "⏰ Sesi dimulai sebentar lagi!",
        `${row.service_name} dimulai pukul ${row.start_time} ${row.timezone}. Silakan bersiap untuk check-in.`,
        { booking_id: row.booking_id }
      );
    }

    res.json({ success: true, processed: result.rows.length });
  } catch (err) {
    console.error("Cron booking reminder error:", err.message);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

module.exports = router;