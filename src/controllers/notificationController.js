const pool = require("../config/db");

const getNotifications = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT id, type, title, body, is_read, data, created_at
       FROM user_notification WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    const unreadCount = result.rows.filter((n) => !n.is_read).length;
    return res.status(200).json({ success: true, data: result.rows, unread_count: unreadCount });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const markAllRead = async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query(
      "UPDATE user_notification SET is_read = true WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteNotification = async (req, res) => {
  const userId = req.user.id;
  const notifId = parseInt(req.params.id);
  try {
    await pool.query(
      "DELETE FROM user_notification WHERE id = $1 AND user_id = $2",
      [notifId, userId]
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Dipanggil dari controller lain (bukan route langsung)
 */
const createNotification = async (userId, type, title, body, data = {}) => {
  try {
    await pool.query(
      `INSERT INTO user_notification (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, JSON.stringify(data)]
    );
  } catch (err) {
    console.error("Create notification error:", err.message);
  }
};

module.exports = { getNotifications, markAllRead, deleteNotification, createNotification };