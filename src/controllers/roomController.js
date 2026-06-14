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

const getAllRooms = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  try {
    const typesResult = await pool.query(
      `SELECT id, name, created_at
       FROM room_type
       WHERE branch_id = $1
       ORDER BY created_at ASC`,
      [branchId]
    );

    const typesWithRooms = await Promise.all(
      typesResult.rows.map(async (type) => {
        const roomsResult = await pool.query(
          `SELECT id, name, capacity, created_at
           FROM room_name
           WHERE room_type_id = $1
           ORDER BY created_at ASC`,
          [type.id]
        );
        return {
          id: type.id,
          name: type.name,
          created_at: type.created_at,
          rooms: roomsResult.rows,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: typesWithRooms,
    });
  } catch (err) {
    console.error("Get rooms error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createRoomType = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama room type wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO room_type (branch_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at`,
      [branchId, name.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Room type berhasil ditambahkan",
      data: { ...result.rows[0], rooms: [] },
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Room type "${name.trim()}" sudah ada di cabang ini`,
      });
    }
    console.error("Create room type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateRoomType = async (req, res) => {
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
      `UPDATE room_type
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3
       RETURNING id, name`,
      [name.trim(), typeId, branchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room type tidak ditemukan" });
    }

    return res.status(200).json({
      success: true,
      message: "Room type berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Room type "${name.trim()}" sudah ada`,
      });
    }
    console.error("Update room type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteRoomType = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const typeId = parseInt(req.params.id);
  if (isNaN(typeId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id FROM room_type WHERE id = $1 AND branch_id = $2`,
      [typeId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Room type tidak ditemukan" });
    }

    const roomNames = await client.query(
      `SELECT id FROM room_name WHERE room_type_id = $1`, 
      [typeId]
    );

    for (const room of roomNames.rows) {
      await softDeleteSchedulesByCondition(client, "room_name_id = $1", [room.id]);
    }

    const result = await client.query(
      `DELETE FROM room_type
       WHERE id = $1 AND branch_id = $2
       RETURNING id, name`,
      [typeId, branchId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Room type "${result.rows[0].name}" berhasil dihapus`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete room type error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

const createRoomName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const typeId = parseInt(req.params.typeId);
  const { name, capacity } = req.body;

  if (isNaN(typeId)) {
    return res.status(400).json({ success: false, message: "ID type tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama ruangan wajib diisi" });
  }
  const cap = parseInt(capacity);
  if (!capacity || isNaN(cap) || cap < 1) {
    return res.status(400).json({
      success: false,
      message: "Kapasitas wajib diisi dan minimal 1",
    });
  }

  try {
    const typeCheck = await pool.query(
      `SELECT id FROM room_type WHERE id = $1 AND branch_id = $2`,
      [typeId, branchId]
    );
    if (typeCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room type tidak ditemukan" });
    }

    const result = await pool.query(
      `INSERT INTO room_name (room_type_id, branch_id, name, capacity)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, capacity, created_at`,
      [typeId, branchId, name.trim(), cap]
    );

    return res.status(201).json({
      success: true,
      message: "Ruangan berhasil ditambahkan",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Ruangan "${name.trim()}" sudah ada di tipe ini`,
      });
    }
    console.error("Create room name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateRoomName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const roomId = parseInt(req.params.id);
  const { name, capacity } = req.body;

  if (isNaN(roomId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama wajib diisi" });
  }
  const cap = parseInt(capacity);
  if (!capacity || isNaN(cap) || cap < 1) {
    return res.status(400).json({
      success: false,
      message: "Kapasitas wajib diisi dan minimal 1",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE room_name
       SET name = $1, capacity = $2, updated_at = NOW()
       WHERE id = $3 AND branch_id = $4
       RETURNING id, name, capacity`,
      [name.trim(), cap, roomId, branchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Ruangan tidak ditemukan" });
    }

    return res.status(200).json({
      success: true,
      message: "Ruangan berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: `Ruangan "${name.trim()}" sudah ada`,
      });
    }
    console.error("Update room name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteRoomName = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) return res.status(400).json({ success: false, message: "ID tidak valid" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id, name FROM room_name WHERE id = $1 AND branch_id = $2`,
      [roomId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Ruangan tidak ditemukan" });
    }

    await client.query(`DELETE FROM schedule WHERE room_name_id = $1`, [roomId]);

    await client.query(`DELETE FROM room_name WHERE id = $1`, [roomId]);
    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Ruangan "${check.rows[0].name}" dan jadwal terkait berhasil dihapus`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete room name error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

const addEquipment = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const roomId = parseInt(req.params.id);
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama equipment wajib diisi" });
  }

  try {
    const check = await pool.query(
      `SELECT id FROM room_name WHERE id = $1 AND branch_id = $2`,
      [roomId, branchId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Ruangan tidak ditemukan" });
    }

    const result = await pool.query(
      `INSERT INTO room_equipment (room_name_id, name) VALUES ($1, $2) RETURNING id, name`,
      [roomId, name.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Equipment berhasil ditambahkan",
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteEquipment = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const equipmentId = parseInt(req.params.equipmentId);

  try {
    const result = await pool.query(
      `DELETE FROM room_equipment re
       USING room_name rn
       WHERE re.id = $1 AND re.room_name_id = rn.id AND rn.branch_id = $2
       RETURNING re.id, re.name`,
      [equipmentId, branchId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Equipment tidak ditemukan" });
    }
    return res.status(200).json({ success: true, message: `Equipment "${result.rows[0].name}" dihapus` });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getEquipment = async (req, res) => {
  const roomId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `SELECT id, name FROM room_equipment WHERE room_name_id = $1 ORDER BY id`,
      [roomId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getAllRooms,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  createRoomName,
  updateRoomName,
  deleteRoomName,
  addEquipment,
  deleteEquipment,
  getEquipment,
};