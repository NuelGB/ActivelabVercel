const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_HOST?.includes("supabase.com")
    ? { rejectUnauthorized: false }
    : false,
});

// Test koneksi saat pertama kali module ini di-load
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Gagal konek ke PostgreSQL:", err.message);
    process.exit(1); // Stop server kalau DB tidak bisa diakses
  }
  release();
  console.log("✅ PostgreSQL terhubung ke database:", process.env.DB_NAME);
});

module.exports = pool;