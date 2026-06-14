const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const uploadToSupabase = require("../utils/uploadToSupabase");

// Helper generate JWT user
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, type: "user" },
    process.env.USER_JWT_SECRET,
    { expiresIn: process.env.USER_JWT_EXPIRES_IN || "30d" }
  );
};

const register = async (req, res) => {
  const { name, email, password, phone, gender } = req.body;

  // Validasi field wajib
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama wajib diisi" });
  }
  if (!email || !email.includes("@")) {
    return res.status(400).json({ success: false, message: "Format email tidak valid" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password minimal 6 karakter" });
  }

  try {
    const existingUser = await pool.query(
      "SELECT id FROM app_user WHERE email = $1 LIMIT 1",
      [email.toLowerCase().trim()]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email sudah terdaftar. Gunakan email lain atau login.",
      });
    }

    // Proses upload foto profil JIKA user melampirkan foto saat registrasi
    let photoUrl = null;
    if (req.file) {
      photoUrl = await uploadToSupabase(req.file, "users");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert user baru
    const result = await pool.query(
      `INSERT INTO app_user (name, email, password, phone, gender, photo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, gender, photo, created_at`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        hashedPassword,
        phone?.trim() || null,
        gender || null,
        photoUrl // Menyimpan null atau URL dari Supabase
      ]
    );

    const newUser = result.rows[0];
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: "Registrasi berhasil",
      data: {
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          gender: newUser.gender,
          photo: newUser.photo || null,
        },
      },
    });
  } catch (err) {
    console.error("Register error:", err.message);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email dan password wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email, password, phone, gender, photo FROM app_user WHERE email = $1 LIMIT 1",
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
    }

    const user = result.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login berhasil",
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          gender: user.gender,
          photo: user.photo || null,
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, gender, photo, created_at FROM app_user WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Get profile error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateProfile = async (req, res) => {
  const { name, phone, gender } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama wajib diisi" });
  }

  try {
    // Ambil data lama untuk mempertahankan foto lama jika user tidak upload foto baru
    const current = await pool.query(
      "SELECT photo FROM app_user WHERE id = $1",
      [req.user.id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }

    const oldPhoto = current.rows[0].photo;
    let newPhotoUrl = oldPhoto; // Set default ke foto lama

    // Pengecekan Aman: Jika user mengunggah file foto baru, baru jalankan Supabase
    if (req.file) {
      const uploadedUrl = await uploadToSupabase(req.file, "users");
      if (uploadedUrl) {
        newPhotoUrl = uploadedUrl;
      }
    }

    const result = await pool.query(
      `UPDATE app_user
       SET name = $1, phone = $2, gender = $3, photo = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, email, phone, gender, photo`,
      [name.trim(), phone?.trim() || null, gender || null, newPhotoUrl, req.user.id]
    );

    return res.status(200).json({
      success: true,
      message: "Profil berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Update profile error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM app_user WHERE id = $1 RETURNING photo",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }

    return res.status(200).json({
      success: true,
      message: "Akun berhasil dihapus",
    });
  } catch (err) {
    console.error("Delete account error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getPaymentHistory = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT
          pt.id, pt.order_id, pt.amount, pt.payment_type,
          pt.transaction_type, pt.status, pt.created_at,
          m.name AS membership_name, m.level,
          b.name AS branch_name
       FROM payment_transaction pt
       LEFT JOIN membership m ON pt.membership_id = m.id
       LEFT JOIN branch b     ON pt.branch_id = b.id
       WHERE pt.user_id = $1 AND pt.hidden_at IS NULL
       ORDER BY pt.created_at DESC`,
      [userId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get payment history error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const hidePayment = async (req, res) => {
  const userId = req.user.id;
  const paymentId = parseInt(req.params.id);

  if (isNaN(paymentId)) {
    return res.status(400).json({ success: false, message: "ID transaksi tidak valid" });
  }

  try {
    const result = await pool.query(
      `UPDATE payment_transaction SET hidden_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [paymentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan atau bukan milik Anda" });
    }

    return res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (err) {
    console.error("Hide payment error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  deleteAccount,
  getPaymentHistory,
  hidePayment,
};