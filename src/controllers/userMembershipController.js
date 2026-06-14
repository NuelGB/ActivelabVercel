const pool = require("../config/db");

const autoExpireOldMemberships = async (userId) => {
  await pool.query(
    `UPDATE user_membership
     SET status = 'expired', updated_at = NOW()
     WHERE user_id = $1 AND status = 'active' AND expire_date < CURRENT_DATE`,
    [userId]
  );
};

/**
 * GET /api/users/memberships
 * Daftar membership milik user (hanya active & frozen, exclude expired & null membership_id)
 */
const getUserMemberships = async (req, res) => {
  const userId = req.user.id;
  try {
    await autoExpireOldMemberships(userId);

    // Pending + checkin expired → cancel (no-show)
    await pool.query(
      `UPDATE booking
       SET status = 'cancelled', updated_at = NOW()
       WHERE user_id = $1
         AND status = 'pending'
         AND checkin_qr_expires_at < NOW()`,
      [userId]
    );

    // Checked-in + checkout expired → auto checkout
    await pool.query(
      `UPDATE booking
       SET status = 'checked_out', checkout_at = NOW(), updated_at = NOW()
       WHERE user_id = $1
         AND status = 'checked_in'
         AND checkout_qr_expires_at IS NOT NULL
         AND checkout_qr_expires_at < NOW()`,
      [userId]
    );

    const result = await pool.query(
      `SELECT
         um.id, um.status, um.expire_date, um.freeze_start,
         m.id AS membership_id, m.name AS membership_name,
         m.price, m.active_days, m.level, m.description,
         b.id AS branch_id, b.name AS branch_name, b.address AS branch_address,
         b.photo AS branch_photo
       FROM user_membership um
       JOIN membership m ON um.membership_id = m.id
       JOIN branch b ON um.branch_id = b.id
       WHERE um.user_id = $1
         AND um.status IN ('active', 'frozen')
         AND um.membership_id IS NOT NULL
       ORDER BY um.created_at DESC`,
      [userId]
    );

    // Tambahkan days_remaining untuk setiap membership
    const memberships = result.rows.map((um) => {
      const today = new Date();
      const expire = new Date(um.expire_date);
      const daysRemaining = Math.max(
        0,
        Math.ceil((expire.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      );
      return { ...um, days_remaining: daysRemaining };
    });

    // Fetch benefits untuk masing-masing membership
    const membershipsWithBenefits = await Promise.all(
      memberships.map(async (um) => {
        const bRes = await pool.query(
          `SELECT sn.id, sn.name FROM membership_benefit mb
           JOIN service_name sn ON mb.service_name_id = sn.id
           WHERE mb.membership_id = $1`,
          [um.membership_id]
        );
        return { ...um, benefits: bRes.rows };
      })
    );

    return res.status(200).json({ success: true, data: membershipsWithBenefits });
  } catch (err) {
    console.error("Get user memberships error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/memberships/:id/freeze
 */
const freezeMembership = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);

  try {
    const check = await pool.query(
      `SELECT id, status FROM user_membership WHERE id = $1 AND user_id = $2`,
      [umId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }
    if (check.rows[0].status !== "active") {
      return res.status(400).json({ success: false, message: "Membership tidak dalam status aktif" });
    }

    const today = new Date().toISOString().split("T")[0];
    await pool.query(
      `UPDATE user_membership
       SET status = 'frozen', freeze_start = $1, updated_at = NOW()
       WHERE id = $2`,
      [today, umId]
    );

    return res.status(200).json({ success: true, message: "Membership berhasil di-freeze" });
  } catch (err) {
    console.error("Freeze membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/memberships/:id/unfreeze
 * Saat unfreeze, tambah expire_date sebesar jumlah hari yang di-freeze
 */
const unfreezeMembership = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);

  try {
    const check = await pool.query(
      `SELECT id, status, freeze_start, expire_date
       FROM user_membership WHERE id = $1 AND user_id = $2`,
      [umId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }
    if (check.rows[0].status !== "frozen") {
      return res.status(400).json({ success: false, message: "Membership tidak sedang di-freeze" });
    }

    const um = check.rows[0];
    const today = new Date();
    const freezeStart = new Date(um.freeze_start);
    const frozenDays = Math.ceil((today.getTime() - freezeStart.getTime()) / (1000 * 60 * 60 * 24));

    // Extend expire_date
    const currentExpire = new Date(um.expire_date);
    currentExpire.setDate(currentExpire.getDate() + frozenDays);
    const newExpireStr = currentExpire.toISOString().split("T")[0];

    await pool.query(
      `UPDATE user_membership
       SET status = 'active', freeze_start = NULL, expire_date = $1, updated_at = NOW()
       WHERE id = $2`,
      [newExpireStr, umId]
    );

    return res.status(200).json({
      success: true,
      message: `Membership aktif kembali. Expire date diperpanjang ${frozenDays} hari.`,
    });
  } catch (err) {
    console.error("Unfreeze membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/users/memberships/:id/upgrade-options
 * Ambil opsi upgrade (level lebih tinggi dari branch yang sama)
 */
const getUpgradeOptions = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);

  try {
    const umResult = await pool.query(
      `SELECT um.branch_id, m.level
       FROM user_membership um
       JOIN membership m ON um.membership_id = m.id
       WHERE um.id = $1 AND um.user_id = $2`,
      [umId, userId]
    );
    if (umResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const { branch_id, level } = umResult.rows[0];

    const options = await pool.query(
      `SELECT id, name, price, active_days, description, level
       FROM membership
       WHERE branch_id = $1 AND level > $2
       ORDER BY level ASC`,
      [branch_id, level]
    );

    return res.status(200).json({ success: true, data: options.rows });
  } catch (err) {
    console.error("Get upgrade options error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/users/memberships/:id/downgrade-options
 */
const getDowngradeOptions = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);

  try {
    const umResult = await pool.query(
      `SELECT um.branch_id, m.level
       FROM user_membership um
       JOIN membership m ON um.membership_id = m.id
       WHERE um.id = $1 AND um.user_id = $2`,
      [umId, userId]
    );
    if (umResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const { branch_id, level } = umResult.rows[0];

    const options = await pool.query(
      `SELECT id, name, price, active_days, description, level
       FROM membership
       WHERE branch_id = $1 AND level < $2
       ORDER BY level DESC`,
      [branch_id, level]
    );

    return res.status(200).json({ success: true, data: options.rows });
  } catch (err) {
    console.error("Get downgrade options error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/memberships/:id/downgrade
 * Body: { new_membership_id }
 * Gratis — hanya update membership_id, expire_date tetap sama
 */
const downgradeMembership = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);
  const { new_membership_id } = req.body;

  if (!new_membership_id) {
    return res.status(400).json({ success: false, message: "new_membership_id wajib diisi" });
  }

  try {
    const umResult = await pool.query(
      `SELECT um.id, um.branch_id, m.level AS current_level
       FROM user_membership um
       JOIN membership m ON um.membership_id = m.id
       WHERE um.id = $1 AND um.user_id = $2`,
      [umId, userId]
    );
    if (umResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const { branch_id, current_level } = umResult.rows[0];


    const newMem = await pool.query(
      `SELECT id, name, level FROM membership WHERE id = $1 AND branch_id = $2 AND level < $3`,
      [new_membership_id, branch_id, current_level]
    );
    if (newMem.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Opsi downgrade tidak valid" });
    }


    await pool.query(
      `UPDATE user_membership SET membership_id = $1, updated_at = NOW() WHERE id = $2`,
      [new_membership_id, umId]
    );

    return res.status(200).json({
      success: true,
      message: `Membership berhasil di-downgrade ke "${newMem.rows[0].name}"`,
    });
  } catch (err) {
    console.error("Downgrade membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/memberships/:id/cancel
 * Berhenti berlangganan
 */
const cancelMembership = async (req, res) => {
  const userId = req.user.id;
  const umId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE user_membership
       SET status = 'expired', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('active', 'frozen')
       RETURNING id`,
      [umId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Membership tidak ditemukan atau sudah tidak aktif",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Membership berhasil diberhentikan",
    });
  } catch (err) {
    console.error("Cancel membership error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getUserMemberships,
  freezeMembership,
  unfreezeMembership,
  getUpgradeOptions,
  getDowngradeOptions,
  downgradeMembership,
  cancelMembership, // ← ditambahkan
};