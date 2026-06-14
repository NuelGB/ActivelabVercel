const pool = require("../config/db");
const { softDeleteSchedulesByCondition } = require("../utils/scheduleCleanup");


const getBranchId = (req, res) => {
  const branchId = req.admin.branch_id;
  if (!branchId) {
    res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
    return null;
  }
  return branchId;
};


/**
 * GET /api/services
 * Ambil semua service type + service name milik branch admin
 */
const getAllServices = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  try {
    // Ambil semua service_type milik branch ini
    const typesResult = await pool.query(
      `SELECT id, name, created_at
       FROM service_type
       WHERE branch_id = $1
       ORDER BY created_at ASC`,
      [branchId]
    );


    const typesWithNames = await Promise.all(
      typesResult.rows.map(async (type) => {
        const namesResult = await pool.query(
          `SELECT id, name, created_at
           FROM service_name
           WHERE service_type_id = $1
           ORDER BY created_at ASC`,
          [type.id]
        );
        return {
          id: type.id,
          name: type.name,
          created_at: type.created_at,
          services: namesResult.rows,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: typesWithNames,
    });
  } catch (err) {
    console.error("Get services error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/services/types

 */
const createServiceType = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: "Nama service type wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO service_type (branch_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at`,
      [branchId, name.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Service type berhasil ditambahkan",
      data: { ...result.rows[0], services: [] },
    });
  } catch (err) {
    // Unique constraint violation (nama duplikat di branch yang sama)
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Service type "${name.trim()}" sudah ada di cabang ini`,
      });
    }
    console.error("Create service type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/services/types/:id

 */
const updateServiceType = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const typeId = parseInt(req.params.id);
  const { name } = req.body;

  if (isNaN(typeId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE service_type
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3
       RETURNING id, name`,
      [name.trim(), typeId, branchId]
    );


    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service type tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service type berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Service type "${name.trim()}" sudah ada`,
      });
    }
    console.error("Update service type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/services/types/:id
 * Hapus service type beserta semua service name di dalamnya
 */
const deleteServiceType = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const typeId = parseInt(req.params.id);
  if (isNaN(typeId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Pastikan service type exist dan milik branch
    const check = await client.query(
      `SELECT id FROM service_type WHERE id = $1 AND branch_id = $2`,
      [typeId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Service type tidak ditemukan",
      });
    }

    // 2. Cascade: Cari service_name di bawah tipe ini, lalu soft-delete jadwalnya
    const serviceNames = await client.query(
      `SELECT id FROM service_name WHERE service_type_id = $1`,
      [typeId]
    );
    for (const sn of serviceNames.rows) {
      await softDeleteSchedulesByCondition(client, "service_name_id = $1", [sn.id]);
    }

    // 3. Hapus service type (ON DELETE CASCADE di DB juga akan menghapus service_name-nya)
    const result = await client.query(
      `DELETE FROM service_type
       WHERE id = $1 AND branch_id = $2
       RETURNING id, name`,
      [typeId, branchId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Service type "${result.rows[0].name}" berhasil dihapus`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete service type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// SERVICE NAME


/**
 * POST /api/services/types/:typeId/names
 * Tambah service name ke dalam service type tertentu
 * Body: { name }
 */
const createServiceName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const typeId = parseInt(req.params.typeId);
  const { name } = req.body;

  if (isNaN(typeId)) {
    return res.status(400).json({ success: false, message: "ID type tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama service wajib diisi" });
  }

  try {
    // Pastikan service_type ini milik branch admin yang login
    const typeCheck = await pool.query(
      `SELECT id FROM service_type WHERE id = $1 AND branch_id = $2`,
      [typeId, branchId]
    );
    if (typeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service type tidak ditemukan",
      });
    }

    const result = await pool.query(
      `INSERT INTO service_name (service_type_id, branch_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
      [typeId, branchId, name.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Service berhasil ditambahkan",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Service "${name.trim()}" sudah ada di tipe ini`,
      });
    }
    console.error("Create service name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/services/names/:id
 * Edit nama service
 * Body: { name }
 */
const updateServiceName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const nameId = parseInt(req.params.id);
  const { name } = req.body;

  if (isNaN(nameId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE service_name
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3
       RETURNING id, name`,
      [name.trim(), nameId, branchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Service "${name.trim()}" sudah ada`,
      });
    }
    console.error("Update service name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/services/names/:id
 * Hapus service name
 */
const deleteServiceName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const nameId = parseInt(req.params.id);
  if (isNaN(nameId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Pastikan service exist dan milik branch yang sesuai
    const check = await client.query(
      `SELECT id, name FROM service_name WHERE id = $1 AND branch_id = $2`,
      [nameId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Service tidak ditemukan",
      });
    }

    // 2. Cascade: soft-delete schedules terkait
    await client.query(`DELETE FROM schedule WHERE service_name_id = $1`, [nameId]);

    // 3. Eksekusi hapus service_name
    const result = await client.query(
      `DELETE FROM service_name
       WHERE id = $1 AND branch_id = $2
       RETURNING id, name`,
      [nameId, branchId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Service "${result.rows[0].name}" dan jadwal terkait berhasil dihapus`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete service name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = {
  getAllServices,
  createServiceType,
  updateServiceType,
  deleteServiceType,
  createServiceName,
  updateServiceName,
  deleteServiceName,
};