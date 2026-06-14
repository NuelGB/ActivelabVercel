const pool = require("../config/db");

/**
 * GET /api/public/branches?page=1&limit=10
 * Ambil semua cabang dengan pagination — tidak butuh login
 */
const getBranches = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(`SELECT COUNT(*) FROM branch`);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT id, name, address, contact, photo, operational_hours, time_slots
       FROM branch
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: {
        branches: result.rows,
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error("Get branches public error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/public/branches/:id
 * Detail cabang + daftar membership tersedia + tipe layanan
 */
const getBranchDetail = async (req, res) => {
  const branchId = parseInt(req.params.id);
  if (isNaN(branchId)) {
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  try {
    // Data branch
    const branchResult = await pool.query(
      `SELECT id, name, address, contact, photo, operational_hours
       FROM branch WHERE id = $1`,
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Cabang tidak ditemukan" });
    }

    const branch = branchResult.rows[0];

    // Daftar membership cabang ini (dengan benefits)
    const membershipResult = await pool.query(
      `SELECT id, name, price, active_days, description, level
       FROM membership
       WHERE branch_id = $1
       ORDER BY level ASC`,
      [branchId]
    );

    const membershipsWithBenefits = await Promise.all(
      membershipResult.rows.map(async (m) => {
        const benefitRes = await pool.query(
          `SELECT sn.id, sn.name FROM membership_benefit mb
           JOIN service_name sn ON mb.service_name_id = sn.id
           WHERE mb.membership_id = $1`,
          [m.id]
        );
        return { ...m, benefits: benefitRes.rows };
      })
    );

    // ─── Service Types ────────────────────────────────────────────
    const serviceTypeResult = await pool.query(
      `SELECT DISTINCT st.id, st.name
       FROM service_type st
       WHERE st.branch_id = $1
       ORDER BY st.name ASC`,
      [branchId]
    );

    const serviceTypes = await Promise.all(
      serviceTypeResult.rows.map(async (type) => {
        const namesResult = await pool.query(
          `SELECT id, name FROM service_name WHERE service_type_id = $1 ORDER BY name ASC`,
          [type.id]
        );
        return { ...type, service_names: namesResult.rows };
      })
    );

    // Kembalikan di response:
    return res.status(200).json({
      success: true,
      data: {
        branch,
        memberships: membershipsWithBenefits,
        service_types: serviceTypes,
      },
    });
  } catch (err) {
    console.error("Get branch detail error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getBranches, getBranchDetail };