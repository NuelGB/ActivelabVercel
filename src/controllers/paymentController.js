const pool = require("../config/db");
const midtransClient = require("midtrans-client");
const { v4: uuidv4 } = require("uuid");
const { createNotification } = require("./notificationController");

const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const createPayment = async (req, res) => {
  const userId = req.user.id;
  const { membership_id, transaction_type = "new", user_membership_id } = req.body;

  if (!membership_id) {
    return res.status(400).json({ success: false, message: "membership_id wajib diisi" });
  }

  try {
    const membershipResult = await pool.query(
      `SELECT m.id, m.name, m.price, m.active_days, m.level, m.branch_id, b.name AS branch_name
       FROM membership m
       JOIN branch b ON m.branch_id = b.id
       WHERE m.id = $1`,
      [membership_id]
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership tidak ditemukan" });
    }

    const membership = membershipResult.rows[0];

    if (transaction_type === 'new') {
      const existingMembership = await pool.query(
        `SELECT id FROM user_membership
         WHERE user_id = $1 AND branch_id = $2 AND status IN ('active', 'frozen')`,
        [userId, membership.branch_id]
      );
      if (existingMembership.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Anda sudah memiliki membership aktif di cabang ini. Gunakan Upgrade untuk meningkatkan paket.",
          error_code: "MEMBERSHIP_EXISTS",
        });
      }
    }

    const userResult = await pool.query(
      `SELECT name, email, phone FROM app_user WHERE id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    const orderId = `Activelab-${uuidv4().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const amount = parseInt(membership.price);

    const chargeResponse = await coreApi.charge({
      payment_type: "qris",
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      qris: {
        acquirer: "gopay",
      },
      customer_details: {
        first_name: user.name,
        email: user.email,
        phone: user.phone || "",
      },
      item_details: [
        {
          id: `MBR-${membership.id}`,
          price: amount,
          quantity: 1,
          name: `${membership.name} - ${membership.branch_name}`,
        },
      ],
    });

    const qrImageUrl = chargeResponse.actions?.find(action => action.name === 'generate-qr-code')?.url || null;

    const txResult = await pool.query(
      `INSERT INTO payment_transaction
          (user_id, user_membership_id, membership_id, branch_id, order_id,
           amount, transaction_type, qr_string)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        userId,
        user_membership_id || null,
        membership_id,
        membership.branch_id,
        orderId,
        amount,
        transaction_type,
        chargeResponse.qr_string || null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: {
        transaction_id: txResult.rows[0].id,
        order_id: orderId,
        amount,
        qr_string: chargeResponse.qr_string,
        qr_image_url: qrImageUrl,
        expiry_time: chargeResponse.expiry_time,
        membership: {
          id: membership.id,
          name: membership.name,
          level: membership.level,
          active_days: membership.active_days,
          branch_name: membership.branch_name,
        },
        simulator_url: "https://simulator.sandbox.midtrans.com/qris/index",
      },
    });
  } catch (err) {
    if (err.ApiResponse) {
    }
    return res.status(500).json({ success: false, message: "Gagal membuat transaksi pembayaran" });
  }
};

const checkPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const txResult = await pool.query(
      `SELECT pt.*, m.name AS membership_name, m.active_days, m.level
       FROM payment_transaction pt
       JOIN membership m ON pt.membership_id = m.id
       WHERE pt.order_id = $1 AND pt.user_id = $2`,
      [orderId, userId]
    );

    if (txResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan" });
    }

    const tx = txResult.rows[0];

    if (tx.status === "success") {
      return res.status(200).json({ success: true, data: { status: "success", order_id: orderId } });
    }

    const midtransStatus = await coreApi.transaction.status(orderId);
    const txStatus = midtransStatus.transaction_status;

    if (txStatus === "settlement" || txStatus === "capture") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `UPDATE payment_transaction
           SET status = 'success', midtrans_transaction_id = $1, updated_at = NOW()
           WHERE order_id = $2`,
          [midtransStatus.transaction_id, orderId]
        );

        await _processSuccessfulPayment(client, tx, userId);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      return res.status(200).json({
        success: true,
        data: { status: "success", order_id: orderId },
      });
    }

    if (txStatus === "expire") {
      await pool.query(
        `UPDATE payment_transaction SET status = 'expired', updated_at = NOW()
         WHERE order_id = $1`,
        [orderId]
      );
      return res.status(200).json({
        success: true,
        data: { status: "expired", order_id: orderId },
      });
    }

    return res.status(200).json({
      success: true,
      data: { status: "pending", order_id: orderId },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Gagal mengecek status pembayaran" });
  }
};

const handleNotification = async (req, res) => {
  try {
    const notification = req.body;
    const orderId = notification.order_id;

    const statusResponse = await coreApi.transaction.notification(notification);
    const statusCode = statusResponse.status_code;
    const finalStatus = statusResponse.transaction_status;

    if ((finalStatus === "settlement" || finalStatus === "capture") && statusCode === "200") {
      const txResult = await pool.query(
        `SELECT pt.*, m.active_days
         FROM payment_transaction pt
         JOIN membership m ON pt.membership_id = m.id
         WHERE pt.order_id = $1`,
        [orderId]
      );

      if (txResult.rows.length > 0 && txResult.rows[0].status !== "success") {
        const tx = txResult.rows[0];
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE payment_transaction
             SET status = 'success', midtrans_transaction_id = $1, updated_at = NOW()
             WHERE order_id = $2`,
            [statusResponse.transaction_id, orderId]
          );
          await _processSuccessfulPayment(client, tx, tx.user_id);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    } else if (finalStatus === "expire" || finalStatus === "cancel" || finalStatus === "deny") {
      await pool.query(
        `UPDATE payment_transaction SET status = 'failed', updated_at = NOW()
         WHERE order_id = $1`,
        [orderId]
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal Server Error Webhook" });
  }
};

async function _processSuccessfulPayment(client, tx, userId) {
  const mRes = await client.query(
    `SELECT m.active_days, m.name, b.name AS branch_name
     FROM membership m JOIN branch b ON m.branch_id = b.id
     WHERE m.id = $1`,
    [tx.membership_id]
  );

  const activeDays = tx.active_days || mRes.rows[0]?.active_days || 30;
  const membershipName = tx.membership_name || mRes.rows[0]?.name || "Membership";
  const branchName = tx.branch_name || mRes.rows[0]?.branch_name || "";

  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + activeDays);
  const expireDateStr = expireDate.toISOString().split("T")[0];

  if (tx.transaction_type === "new") {
    const umResult = await client.query(
      `INSERT INTO user_membership (user_id, membership_id, branch_id, status, expire_date)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [userId, tx.membership_id, tx.branch_id, expireDateStr]
    );
    await client.query(
      `UPDATE payment_transaction SET user_membership_id = $1 WHERE id = $2`,
      [umResult.rows[0].id, tx.id]
    );

  } else if (tx.transaction_type === "renew" && tx.user_membership_id) {
    const currentUM = await client.query(
      `SELECT expire_date, status FROM user_membership WHERE id = $1`,
      [tx.user_membership_id]
    );
    if (currentUM.rows.length > 0) {
      const currentExpire = new Date(currentUM.rows[0].expire_date);
      const now = new Date();
      const baseDate = currentExpire < now ? now : currentExpire;
      const newExpire = new Date(baseDate);
      newExpire.setDate(newExpire.getDate() + activeDays);
      await client.query(
        `UPDATE user_membership
         SET expire_date = $1, status = 'active', updated_at = NOW()
         WHERE id = $2`,
        [newExpire.toISOString().split("T")[0], tx.user_membership_id]
      );
    }

  } else if (tx.transaction_type === "upgrade" && tx.user_membership_id) {
    await client.query(
      `UPDATE user_membership SET status = 'expired', updated_at = NOW() WHERE id = $1`,
      [tx.user_membership_id]
    );
    const umResult = await client.query(
      `INSERT INTO user_membership (user_id, membership_id, branch_id, status, expire_date)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [userId, tx.membership_id, tx.branch_id, expireDateStr]
    );
    await client.query(
      `UPDATE payment_transaction SET user_membership_id = $1 WHERE id = $2`,
      [umResult.rows[0].id, tx.id]
    );
  }

  try {
    await createNotification(
      userId,
      "payment_success",
      "✅ Pembayaran Berhasil!",
      `${membershipName}${branchName ? ` di ${branchName}` : ""} sudah aktif. Selamat menikmati layanan ActiveLab!`,
      { transaction_id: tx.id, order_id: tx.order_id }
    );
  } catch (_) {}
}

module.exports = { createPayment, checkPaymentStatus, handleNotification };