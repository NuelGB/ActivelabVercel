const pool = require("../config/db");

/**
 * Soft-delete schedules berdasarkan kondisi tertentu
 * Otomatis cancel pending bookings yang terdampak
 */
const softDeleteSchedulesByCondition = async (client, whereClause, params) => {
  // 1. Cancel semua pending booking yang terdampak
  await client.query(
    `UPDATE booking
     SET status = 'cancelled', updated_at = NOW()
     WHERE schedule_id IN (
       SELECT id FROM schedule WHERE ${whereClause} AND hidden_at IS NULL
     ) AND status = 'pending'`,
    params
  );

  // 2. Soft-delete schedule
  await client.query(
    `UPDATE schedule SET hidden_at = NOW()
     WHERE ${whereClause} AND hidden_at IS NULL`,
    params
  );
};

module.exports = { softDeleteSchedulesByCondition };