const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
const login = async (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email dan password wajib diisi",
    });
  }

  try {
    // 1. Cari admin berdasarkan email
    const result = await pool.query(
      `SELECT 
         a.id,
         a.email,
         a.password,
         a.phone,
         a.role,
         a.photo,
         a.branch_id,
         b.name AS branch_name,
         b.address AS branch_address
       FROM admin a
       LEFT JOIN branch b ON a.branch_id = b.id
       WHERE a.email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
    }

    const admin = result.rows[0];

    // 3. Verifikasi password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
    }

    // 4. Generate JWT Token
    const tokenPayload = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      branch_id: admin.branch_id,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    // 5. Kembalikan response (tanpa password)
    return res.status(200).json({
      success: true,
      message: "Login berhasil",
      data: {
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          phone: admin.phone,
          role: admin.role,
          photo: admin.photo,
          branch: admin.branch_id
            ? {
                id: admin.branch_id,
                name: admin.branch_name,
                address: admin.branch_address,
              }
            : null,
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server. Coba lagi nanti.",
    });
  }
};

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 * Ambil data admin yang sedang login
 */
const getMe = async (req, res) => {
  try {
    const result = await pool.query(
  `SELECT 
     a.id,
     a.email,
     a.password,
     a.phone,
     a.role,
     a.photo,
     a.branch_id,
     b.name AS branch_name,
     b.address AS branch_address
   FROM admin a
   LEFT JOIN branch b ON a.branch_id = b.id
   WHERE a.email = $1
   LIMIT 1`,
  [email.toLowerCase().trim()]
);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Admin tidak ditemukan" });
    }

    const admin = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: admin.id,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        photo: admin.photo,
        created_at: admin.created_at,
        branch: admin.branch_id
          ? {
              id: admin.branch_id,
              name: admin.branch_name,
              address: admin.branch_address,
              contact: admin.branch_contact,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("GetMe error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { login, getMe };