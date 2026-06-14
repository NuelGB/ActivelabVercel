require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./src/config/db");

/**
 * SEED: Buat akun admin pusat pertama kalinya
 *
 * ⚠️  HAPUS FILE INI SETELAH BERHASIL DIJALANKAN
 *
 * Cara pakai:
 *   node seed.js
 *
 * Yang di-insert:
 *   1. Branch "Jakarta Pusat" sebagai branch asal admin pusat
 *   2. Akun admin pusat dengan role = 'pusat'
 */

const ADMIN_PUSAT = {
  email: "anuelgaliano78@gmail.com",
  password: "Admin123",   // ← ganti sebelum production
  phone: "08100000001",
  role: "pusat",
};

const BRANCH_PUSAT = {
  name: "GymActivelab Jakarta Pusat",
  address: "Jl. Sudirman No. 1, Jakarta Pusat, DKI Jakarta 10220",
  contact: "02100000001",
  operational_hours: {
    senin: { open: "06:00", close: "22:00" },
    selasa: { open: "06:00", close: "22:00" },
    rabu: { open: "06:00", close: "22:00" },
    kamis: { open: "06:00", close: "22:00" },
    jumat: { open: "06:00", close: "22:00" },
    sabtu: { open: "07:00", close: "21:00" },
    minggu: { open: "08:00", close: "20:00" },
  },
  time_slots: ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
               "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
               "19:00", "20:00"],
};

const runSeed = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ─── Cek apakah admin pusat sudah ada ───────────────────
    const existingAdmin = await client.query(
      "SELECT id FROM admin WHERE role = 'pusat' LIMIT 1"
    );
    if (existingAdmin.rows.length > 0) {
      console.log("⚠️  Admin pusat sudah ada. Seed tidak perlu dijalankan lagi.");
      console.log("⚠️  HAPUS FILE seed.js INI SEKARANG!");
      await client.query("ROLLBACK");
      return;
    }

    // ─── 1. Insert branch pusat ──────────────────────────────
    const branchResult = await client.query(
      `INSERT INTO branch (name, address, contact, operational_hours, time_slots)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name`,
      [
        BRANCH_PUSAT.name,
        BRANCH_PUSAT.address,
        BRANCH_PUSAT.contact,
        JSON.stringify(BRANCH_PUSAT.operational_hours),
        JSON.stringify(BRANCH_PUSAT.time_slots),
      ]
    );
    const branch = branchResult.rows[0];
    console.log(`✅ Branch dibuat: [ID: ${branch.id}] ${branch.name}`);

    // ─── 2. Hash password ────────────────────────────────────
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(ADMIN_PUSAT.password, saltRounds);
    console.log("✅ Password berhasil di-hash");

    // ─── 3. Insert admin pusat ───────────────────────────────
    const adminResult = await client.query(
      `INSERT INTO admin (email, password, phone, role, branch_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role`,
      [
        ADMIN_PUSAT.email,
        hashedPassword,
        ADMIN_PUSAT.phone,
        ADMIN_PUSAT.role,
        branch.id,
      ]
    );
    const admin = adminResult.rows[0];

    await client.query("COMMIT");

    console.log("─────────────────────────────────────────────");
    console.log("🎉 SEED BERHASIL! Admin pusat telah dibuat:");
    console.log(`   ID    : ${admin.id}`);
    console.log(`   Email : ${admin.email}`);
    console.log(`   Role  : ${admin.role}`);
    console.log(`   Branch: [ID: ${branch.id}] ${branch.name}`);
    console.log("─────────────────────────────────────────────");
    console.log("⚠️  PENTING: HAPUS FILE seed.js SEKARANG!");
    console.log("   Jalankan: rm seed.js");
    console.log("─────────────────────────────────────────────");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Seed gagal:", err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
};

runSeed().catch(() => process.exit(1));