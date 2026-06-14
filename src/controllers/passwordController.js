const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { sendAdminResetPasswordEmail } = require("../services/emailService");

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({
      success: false,
      message: "Format email tidak valid",
    });
  }

  const genericResponse = {
    success: true,
    message: "Jika email terdaftar, instruksi reset password telah dikirim ke inbox Anda.",
  };

  try {
    const adminResult = await pool.query(
      `SELECT id, email FROM admin WHERE email = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (adminResult.rows.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return res.status(200).json(genericResponse);
    }

    const admin = adminResult.rows[0];

    await pool.query(
      `DELETE FROM password_reset_tokens 
       WHERE admin_id = $1 AND used_at IS NULL`,
      [admin.id]
    );

    const rawToken = crypto.randomBytes(32).toString("hex");

    const expiresMinutes = parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES) || 30;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (admin_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [admin.id, rawToken, expiresAt]
    );

    await sendAdminResetPasswordEmail(admin.email, rawToken);

    return res.status(200).json(genericResponse);

  } catch (err) {
    console.error("Forgot password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan. Coba beberapa saat lagi.",
    });
  }
};

const validateResetToken = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "Token tidak ditemukan",
    });
  }

  try {
    const result = await pool.query(
      `SELECT 
         prt.id,
         prt.admin_id,
         prt.expires_at,
         prt.used_at,
         a.email
       FROM password_reset_tokens prt
       JOIN admin a ON prt.admin_id = a.id
       WHERE prt.token = $1
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Link reset password tidak valid atau sudah tidak berlaku",
      });
    }

    const tokenData = result.rows[0];

    if (tokenData.used_at !== null) {
      return res.status(400).json({
        success: false,
        message: "Link reset password ini sudah pernah digunakan",
      });
    }

    if (new Date() > new Date(tokenData.expires_at)) {
      return res.status(400).json({
        success: false,
        message: "Link reset password sudah kadaluarsa. Silakan minta link baru.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Token valid",
      data: {
        email: tokenData.email,
        expires_at: tokenData.expires_at,
      },
    });

  } catch (err) {
    console.error("Validate token error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const resetPassword = async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;

  if (!token || !newPassword || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Token, password baru, dan konfirmasi password wajib diisi",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Password baru dan konfirmasi password tidak cocok",
    });
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "Password minimal 8 karakter dan harus mengandung huruf besar, huruf kecil, dan angka",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tokenResult = await client.query(
      `SELECT prt.id, prt.admin_id, prt.expires_at, prt.used_at
       FROM password_reset_tokens prt
       WHERE prt.token = $1
       LIMIT 1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Link reset password tidak valid",
      });
    }

    const tokenData = tokenResult.rows[0];

    if (tokenData.used_at !== null) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Link ini sudah pernah digunakan. Silakan minta link reset baru.",
      });
    }

    if (new Date() > new Date(tokenData.expires_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Link reset password sudah kadaluarsa. Silakan minta link baru.",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await client.query(
      `UPDATE admin 
       SET password = $1, updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, tokenData.admin_id]
    );

    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE id = $1`,
      [tokenData.id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Password berhasil direset. Silakan login dengan password baru Anda.",
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reset password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan. Coba beberapa saat lagi.",
    });
  } finally {
    client.release();
  }
};

module.exports = { forgotPassword, validateResetToken, resetPassword };