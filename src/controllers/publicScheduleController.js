const pool = require("../config/db");

const getPublicSchedules = async (req, res) => {
  const { branch_id, service_name_id } = req.query;

  if (!branch_id || !service_name_id) {
    return res.status(400).json({
      success: false,
      message: "branch_id dan service_name_id wajib diisi",
    });
  }

  try {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 6);
    const endDateStr = endDate.toISOString().split("T")[0];

    const cutoff = new Date(today.getTime() + 1 * 60 * 1000);
    const cutoffTimeStr = cutoff.toTimeString().slice(0, 5);

    const result = await pool.query(
      `SELECT
         s.id,
         TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
         TO_CHAR(s.end_time, 'HH24:MI') AS end_time,
         s.duration_minutes,
         s.timezone,
         s.slot AS total_slots,
         s.slot
          - COALESCE((
              SELECT COUNT(*) FROM booking b
              WHERE b.schedule_id = s.id AND b.status NOT IN ('cancelled')
            ), 0)
          - COALESCE((
              SELECT COUNT(*) FROM walkin_booking wb
              WHERE wb.service_name_id = s.service_name_id
                AND wb.room_name_id = s.room_name_id
                AND wb.date = s.date
                AND wb.start_time < s.end_time
                AND wb.end_time > s.start_time
                AND wb.hidden_at IS NULL
            ), 0) AS available_slots,
         st.id AS service_type_id, st.name AS service_type_name,
         sn.id AS service_name_id, sn.name AS service_name_name,
         rt.id AS room_type_id, rt.name AS room_type_name,
         rn.id AS room_name_id, rn.name AS room_name_name,
         COALESCE(
           (SELECT json_agg(re.name ORDER BY re.id)
            FROM room_equipment re WHERE re.room_name_id = rn.id),
           '[]'::json
         ) AS room_equipment
       FROM schedule s
       JOIN service_type st ON s.service_type_id = st.id
       JOIN service_name sn ON s.service_name_id = sn.id
       JOIN room_type rt ON s.room_type_id = rt.id
       JOIN room_name rn ON s.room_name_id = rn.id
       WHERE s.branch_id = $1
         AND s.service_name_id = $2
         AND s.date BETWEEN $3::date AND $4::date
         AND s.hidden_at IS NULL
         AND (
           s.date > $3::date
           OR (s.date = $3::date AND s.start_time > $5::time)
         )
       ORDER BY s.date ASC, s.start_time ASC`,
      [branch_id, service_name_id, todayStr, endDateStr, cutoffTimeStr]
    );

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
          total_slots: row.total_slots,
          available_slots: Math.max(0, parseInt(row.available_slots)),
          service_type: { id: row.service_type_id, name: row.service_type_name },
          service_name: { id: row.service_name_id, name: row.service_name_name },
          room_type: { id: row.room_type_id, name: row.room_type_name },
          room_name: {
            id: row.room_name_id,
            name: row.room_name_name,
            equipment: row.room_equipment || [],
          },
          staffs: staffResult.rows,
        };
      })
    );

    const grouped = {};
    for (const s of schedules) {
      if (!grouped[s.date]) grouped[s.date] = [];
      grouped[s.date].push(s);
    }

    return res.status(200).json({ success: true, data: grouped });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPublicSchedules };