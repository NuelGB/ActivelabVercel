const pool = require("../config/db");

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

const fetchMembershipsWithBenefits = async (branchId) => {
  const memberships = await pool.query(
    `SELECT id, name, price, active_days, description, level, created_at
     FROM membership
     WHERE branch_id = $1
     ORDER BY level ASC`,
    [branchId]
  );

  const result = await Promise.all(
    memberships.rows.map(async (m) => {
      const benefits = await pool.query(
        `SELECT sn.id, sn.name
         FROM membership_benefit mb
         JOIN service_name sn ON mb.service_name_id = sn.id
         WHERE mb.membership_id = $1`,
        [m.id]
      );
      return {
        ...m,
        benefits: benefits.rows,
      };
    })
  );

  return result;
};

const getAllMemberships = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  try {
    const data = await fetchMembershipsWithBenefits(branchId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Get memberships error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createMembership = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const { name, price, active_days, description, benefit_ids } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama membership wajib diisi" });
  }
  if (price === undefined || price === null || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ success: false, message: "Harga tidak valid" });
  }
  if (!active_days || isNaN(Number(active_days)) || Number(active_days) < 1) {
    return res.status(400).json({ success: false, message: "Masa aktif minimal 1 hari" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const maxLevelResult = await client.query(
      `SELECT COALESCE(MAX(level), 0) AS max_level FROM membership WHERE branch_id = $1`,
      [branchId]
    );
    const newLevel = maxLevelResult.rows[0].max_level + 1;
    
    const membershipResult = await client.query(
      `INSERT INTO membership (branch_id, name, price, active_days, description, level)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, price, active_days, description, level`,
      [branchId, name.trim(), Number(price), Number(active_days), description?.trim() || null, newLevel]
    );
    const newMembership = membershipResult.rows[0];

    const benefitIds = Array.isArray(benefit_ids) ? benefit_ids : [];
    if (benefitIds.length > 0) {
      const validCheck = await client.query(
        `SELECT id FROM service_name WHERE id = ANY($1) AND branch_id = $2`,
        [benefitIds, branchId]
      );
      if (validCheck.rows.length !== benefitIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Beberapa benefit tidak valid atau bukan milik cabang ini",
        });
      }

      const benefitValues = benefitIds
        .map((sid) => `(${newMembership.id}, ${sid})`)
        .join(", ");
      await client.query(
        `INSERT INTO membership_benefit (membership_id, service_name_id) VALUES ${benefitValues}`
      );
    }

    await client.query("COMMIT");

    const benefitDetails = await pool.query(
      `SELECT sn.id, sn.name FROM membership_benefit mb
       JOIN service_name sn ON mb.service_name_id = sn.id
       WHERE mb.membership_id = $1`,
      [newMembership.id]
    );

    return res.status(201).json({
      success: true,
      message: `Membership "${newMembership.name}" berhasil ditambahkan sebagai Level ${newLevel}`,
      data: { ...newMembership, benefits: benefitDetails.rows },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};


const updateMembership = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const membershipId = parseInt(req.params.id);
  const { name, price, active_days, description, benefit_ids } = req.body;

  if (isNaN(membershipId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama membership wajib diisi" });
  }
  if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ success: false, message: "Harga tidak valid" });
  }
  if (!active_days || isNaN(Number(active_days)) || Number(active_days) < 1) {
    return res.status(400).json({ success: false, message: "Masa aktif minimal 1 hari" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id FROM membership WHERE id = $1 AND branch_id = $2`,
      [membershipId, branchId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const updated = await client.query(
      `UPDATE membership
       SET name = $1, price = $2, active_days = $3, description = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, price, active_days, description, level`,
      [name.trim(), Number(price), Number(active_days), description?.trim() || null, membershipId]
    );

    await client.query(
      `DELETE FROM membership_benefit WHERE membership_id = $1`,
      [membershipId]
    );

    const benefitIds = Array.isArray(benefit_ids) ? benefit_ids : [];
    if (benefitIds.length > 0) {
      const validCheck = await client.query(
        `SELECT id FROM service_name WHERE id = ANY($1) AND branch_id = $2`,
        [benefitIds, branchId]
      );
      if (validCheck.rows.length !== benefitIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Beberapa benefit tidak valid",
        });
      }

      const benefitValues = benefitIds
        .map((sid) => `(${membershipId}, ${sid})`)
        .join(", ");
      await client.query(
        `INSERT INTO membership_benefit (membership_id, service_name_id) VALUES ${benefitValues}`
      );
    }

    await client.query("COMMIT");

    const benefitDetails = await pool.query(
      `SELECT sn.id, sn.name FROM membership_benefit mb
       JOIN service_name sn ON mb.service_name_id = sn.id
       WHERE mb.membership_id = $1`,
      [membershipId]
    );

    return res.status(200).json({
      success: true,
      message: "Membership berhasil diperbarui",
      data: { ...updated.rows[0], benefits: benefitDetails.rows },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

const deleteMembership = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const membershipId = parseInt(req.params.id);
  if (isNaN(membershipId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT id, name, level FROM membership WHERE id = $1 AND branch_id = $2`,
      [membershipId, branchId]
    );
    if (target.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const deletedLevel = target.rows[0].level;
    const deletedName = target.rows[0].name;

    await client.query(`DELETE FROM membership WHERE id = $1`, [membershipId]);

    await client.query(
      `UPDATE membership
       SET level = level - 1, updated_at = NOW()
       WHERE branch_id = $1 AND level > $2`,
      [branchId, deletedLevel]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Membership "${deletedName}" berhasil dihapus. Level di atasnya telah diperbarui.`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = {
  getAllMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
};