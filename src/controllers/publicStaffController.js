const pool = require("../config/db");

/**
 * GET /api/public/staff?branch_id=X&search=nama
 */
const getPublicStaff = async (req, res) => {
  const { branch_id, search } = req.query;

  try {
    const params = [];
    const conditions = []; 

    if (branch_id) {
      params.push(parseInt(branch_id));
      conditions.push(`s.branch_id = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.toLowerCase().trim()}%`);
      const idx = params.length;
      conditions.push(
        `(LOWER(s.name) LIKE $${idx} OR LOWER(b.name) LIKE $${idx})`
      );
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pool.query(
      `SELECT
         s.id,
         s.name,
         s.contact,
         s.image,
         s.description,
         b.id   AS branch_id,
         b.name AS branch_name
       FROM staff s
       JOIN branch b ON s.branch_id = b.id
       ${whereClause}
       ORDER BY b.name ASC, s.name ASC`,
      params
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get public staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPublicStaff };