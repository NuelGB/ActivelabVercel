const pool = require("../config/db");
const uploadToSupabase = require("../utils/uploadToSupabase"); 
const { softDeleteSchedulesByCondition } = require("../utils/scheduleCleanup");

/**
 * GET /api/staff
 * Ambil semua staff milik branch admin yang login
 */
const getAllStaff = async (req, res) => {
  const branchId = req.admin?.branch_id;
  if (!branchId) {
    return res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, contact, image, description, created_at
       FROM staff
       WHERE branch_id = $1
       ORDER BY created_at DESC`,
      [branchId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Get staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/staff
 * Tambah staff baru
 */
const createStaff = async (req, res) => {
  const branchId = req.admin?.branch_id;
  if (!branchId) {
    return res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
  }

  const { name, contact, description } = req.body;

  // Validasi field wajib
  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: "Nama staff wajib diisi",
    });
  }

  try {
    // Proses Upload Gambar ke Supabase jika file dikirim dari client
    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadToSupabase(req.file, "staffs");
    }

    const result = await pool.query(
      `INSERT INTO staff (branch_id, name, contact, image, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, contact, image, description, created_at`,
      [
        branchId,
        name.trim(),
        contact?.trim() || null,
        imageUrl,
        description?.trim() || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Staff berhasil ditambahkan",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Create staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/staff/:id
 * Edit data staff
 */
const updateStaff = async (req, res) => {
  const branchId = req.admin?.branch_id;
  if (!branchId) {
    return res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
  }

  const staffId = parseInt(req.params.id);
  const { name, contact, description } = req.body;

  if (isNaN(staffId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama staff wajib diisi" });
  }

  try {
    // Cek apakah data staff yang dituju memang ada di bawah cabang milik admin terkait
    const current = await pool.query(
      `SELECT image FROM staff WHERE id = $1 AND branch_id = $2`,
      [staffId, branchId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Staff tidak ditemukan atau bukan milik cabang Anda",
      });
    }

    const oldImage = current.rows[0].image;
    let newImage = oldImage;

    // Jika admin mengunggah file baru, simpan file baru ke Supabase
    if (req.file) {
      newImage = await uploadToSupabase(req.file, "staffs");
    }

    const result = await pool.query(
      `UPDATE staff
       SET name = $1, contact = $2, image = $3, description = $4, updated_at = NOW()
       WHERE id = $5 AND branch_id = $6
       RETURNING id, name, contact, image, description`,
      [
        name.trim(),
        contact?.trim() || null,
        newImage,
        description?.trim() || null,
        staffId,
        branchId,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Data staff berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Update staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/staff/:id
 * Hapus staff beserta soft-delete jadwal terkait
 */
const deleteStaff = async (req, res) => {
  const branchId = req.admin?.branch_id;
  if (!branchId) {
    return res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
  }

  const staffId = parseInt(req.params.id);
  if (isNaN(staffId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const check = await client.query(
        `SELECT id, name FROM staff WHERE id = $1 AND branch_id = $2`,
        [staffId, branchId]
      );
      if (check.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Staff tidak ditemukan atau bukan milik cabang Anda" });
      }

      // Soft-delete semua schedule yang menggunakan staff ini
      const scheduleIds = await client.query(
        `SELECT DISTINCT schedule_id FROM schedule_staff WHERE staff_id = $1`,
        [staffId]
      );
      for (const row of scheduleIds.rows) {
        await softDeleteSchedulesByCondition(client, "id = $1", [row.schedule_id]);
      }

      // Hapus staff dari DB (ON DELETE CASCADE menghapus relasi di schedule_staff secara otomatis)
      await client.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: `Staff "${check.rows[0].name}" dan jadwal terkait berhasil dihapus`,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Delete staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getAllStaff, createStaff, updateStaff, deleteStaff };