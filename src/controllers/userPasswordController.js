const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { sendUserResetPasswordEmail } = require("../services/emailService");

/**
 * POST /api/users/forgot-password
 * Body: { email }
 */
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ success: false, message: "Format email tidak valid" });
  }

  // Selalu return 200 (cegah email enumeration)
  const genericOk = {
    success: true,
    message: "Jika email terdaftar, link reset telah dikirim ke inbox Anda.",
  };

  try {
    const result = await pool.query(
      "SELECT id, name, email FROM app_user WHERE email = $1 LIMIT 1",
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      await new Promise((r) => setTimeout(r, 800));
      return res.status(200).json(genericOk);
    }

    const user = result.rows[0];

    // Hapus token lama
    await pool.query(
      "DELETE FROM user_password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
      [user.id]
    );

    // Generate token baru
    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresMin = parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES) || 30;
    const expiresAt = new Date(Date.now() + expiresMin * 60 * 1000);

    await pool.query(
      "INSERT INTO user_password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)",
      [user.id, rawToken, expiresAt]
    );

    await sendUserResetPasswordEmail(user.email, user.name, rawToken);

    return res.status(200).json(genericOk);
  } catch (err) {
    console.error("User forgot password error:", err.message);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan. Coba lagi." });
  }
};

/**
 * GET /api/users/validate-reset-token?token=xxx
 */
const validateResetToken = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, message: "Token tidak ditemukan" });

  try {
    const result = await pool.query(
      `SELECT uprt.id, uprt.user_id, uprt.expires_at, uprt.used_at, u.email
       FROM user_password_reset_tokens uprt
       JOIN app_user u ON uprt.user_id = u.id
       WHERE uprt.token = $1 LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Link reset tidak valid" });
    }
    const t = result.rows[0];
    if (t.used_at) {
      return res.status(400).json({ success: false, message: "Link sudah pernah digunakan" });
    }
    if (new Date() > new Date(t.expires_at)) {
      return res.status(400).json({ success: false, message: "Link sudah kadaluarsa" });
    }

    return res.status(200).json({
      success: true,
      data: { email: t.email, expires_at: t.expires_at },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/reset-password
 * Body: { token, newPassword, confirmPassword }
 */
const resetPassword = async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;

  if (!token || !newPassword || !confirmPassword) {
    return res.status(400).json({ success: false, message: "Semua field wajib diisi" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: "Password tidak cocok" });
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "Password min 8 karakter, harus ada huruf besar, huruf kecil, dan angka",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT id, user_id, expires_at, used_at FROM user_password_reset_tokens WHERE token = $1 LIMIT 1",
      [token]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Token tidak valid" });
    }
    const t = result.rows[0];
    if (t.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Token sudah digunakan" });
    }
    if (new Date() > new Date(t.expires_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Token sudah kadaluarsa" });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await client.query(
      "UPDATE app_user SET password = $1, updated_at = NOW() WHERE id = $2",
      [hashed, t.user_id]
    );
    await client.query(
      "UPDATE user_password_reset_tokens SET used_at = NOW() WHERE id = $1",
      [t.id]
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "Password berhasil direset. Silakan login." });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = { forgotPassword, validateResetToken, resetPassword };