require("dotenv").config();
const pool = require("./src/config/db");

const createTables = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    
    // TABLE: branch
    await client.query(`
      CREATE TABLE IF NOT EXISTS branch (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        address         TEXT,
        operational_hours JSONB DEFAULT '{}',
        time_slots      JSONB DEFAULT '[]',
        contact         VARCHAR(100),
        photo           VARCHAR(500),
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log("✅ Tabel branch berhasil dibuat");

    // TABLE: admin
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        phone       VARCHAR(50),
        role        VARCHAR(20) NOT NULL DEFAULT 'cabang'
                    CHECK (role IN ('pusat', 'cabang')),
        branch_id   INTEGER REFERENCES branch(id) ON DELETE SET NULL,
        photo       VARCHAR(500),
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log("✅ Tabel admin berhasil dibuat");

// TABLE: service_type
await client.query(`
  CREATE TABLE IF NOT EXISTS service_type (
    id          SERIAL PRIMARY KEY,
    branch_id   INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Satu branch tidak boleh punya service type dengan nama sama
    UNIQUE (branch_id, name)
  );
`);
console.log("✅ Tabel service_type berhasil dibuat");

// TABLE: service_name
await client.query(`
  CREATE TABLE IF NOT EXISTS service_name (
    id              SERIAL PRIMARY KEY,
    service_type_id INTEGER NOT NULL REFERENCES service_type(id) ON DELETE CASCADE,
    branch_id       INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Dalam satu service_type, nama service tidak boleh duplikat
    UNIQUE (service_type_id, name)
  );
`);
console.log("✅ Tabel service_name berhasil dibuat");

// TABLE: room_type
await client.query(`
  CREATE TABLE IF NOT EXISTS room_type (
    id          SERIAL PRIMARY KEY,
    branch_id   INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (branch_id, name)
  );
`);
console.log("✅ Tabel room_type berhasil dibuat");

// TABLE: room_name
await client.query(`
  CREATE TABLE IF NOT EXISTS room_name (
    id           SERIAL PRIMARY KEY,
    room_type_id INTEGER NOT NULL REFERENCES room_type(id) ON DELETE CASCADE,
    branch_id    INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name         VARCHAR(150) NOT NULL,
    capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (room_type_id, name)
  );
`);
console.log("✅ Tabel room_name berhasil dibuat");

await client.query(`
  CREATE TABLE IF NOT EXISTS staff (
    id          SERIAL PRIMARY KEY,
    branch_id   INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    contact     VARCHAR(50),
    image       VARCHAR(500),
    description TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel staff berhasil dibuat");

// TABLE: membership
await client.query(`
  CREATE TABLE IF NOT EXISTS membership (
    id          SERIAL PRIMARY KEY,
    branch_id   INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    price       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    active_days INTEGER NOT NULL DEFAULT 30 CHECK (active_days >= 1),
    description TEXT,
    level       INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- level unik per branch: tidak bisa ada 2 membership level 1 di branch yang sama
    UNIQUE (branch_id, level)
  );
`);
console.log("✅ Tabel membership berhasil dibuat");

// TABLE: membership_benefit
await client.query(`
  CREATE TABLE IF NOT EXISTS membership_benefit (
    id              SERIAL PRIMARY KEY,
    membership_id   INTEGER NOT NULL REFERENCES membership(id) ON DELETE CASCADE,
    service_name_id INTEGER NOT NULL REFERENCES service_name(id) ON DELETE CASCADE,
    -- Satu membership tidak bisa punya benefit yang sama dua kali
    UNIQUE (membership_id, service_name_id)
  );
`);
console.log("✅ Tabel membership_benefit berhasil dibuat");

// TABLE: schedule
await client.query(`
  CREATE TABLE IF NOT EXISTS schedule (
    id              SERIAL PRIMARY KEY,
    branch_id       INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    service_type_id INTEGER NOT NULL REFERENCES service_type(id) ON DELETE RESTRICT,
    service_name_id INTEGER NOT NULL REFERENCES service_name(id) ON DELETE RESTRICT,
    room_type_id    INTEGER NOT NULL REFERENCES room_type(id) ON DELETE RESTRICT,
    room_name_id    INTEGER NOT NULL REFERENCES room_name(id) ON DELETE RESTRICT,
    date            DATE NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    timezone        VARCHAR(10) DEFAULT 'WIB',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel schedule berhasil dibuat");

// TABLE: schedule_staff (junction)
await client.query(`
  CREATE TABLE IF NOT EXISTS schedule_staff (
    id          SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
    staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    UNIQUE (schedule_id, staff_id)
  );
`);
console.log("✅ Tabel schedule_staff berhasil dibuat");

await client.query(`
  CREATE TABLE IF NOT EXISTS app_user (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    phone       VARCHAR(50),
    gender      VARCHAR(20) CHECK (gender IN ('Male', 'Female', 'Other')),
    photo       VARCHAR(500),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel app_user berhasil dibuat");

await client.query(`
  CREATE TABLE IF NOT EXISTS user_membership (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    membership_id   INTEGER REFERENCES membership(id) ON DELETE SET NULL,
    branch_id       INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active', 'frozen', 'expired')),
    expire_date     DATE NOT NULL,
    freeze_start    DATE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel user_membership berhasil dibuat");


await client.query(`
  CREATE TABLE IF NOT EXISTS payment_transaction (
    id                     SERIAL PRIMARY KEY,
    user_id                INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    user_membership_id     INTEGER REFERENCES user_membership(id) ON DELETE SET NULL,
    membership_id          INTEGER REFERENCES membership(id) ON DELETE SET NULL,
    branch_id              INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    order_id               VARCHAR(100) UNIQUE NOT NULL,
    amount                 NUMERIC(12,2) NOT NULL,
    payment_type           VARCHAR(50) DEFAULT 'qris',
    transaction_type       VARCHAR(20) DEFAULT 'new'
                           CHECK (transaction_type IN ('new','renew','upgrade')),
    status                 VARCHAR(20) DEFAULT 'pending'
                           CHECK (status IN ('pending','success','failed','expired')),
    qr_string              TEXT,
    midtrans_transaction_id VARCHAR(200),
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel payment_transaction berhasil dibuat");

// TABLE: booking
await client.query(`
  CREATE TABLE IF NOT EXISTS booking (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    schedule_id           INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
    branch_id             INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    status                VARCHAR(20) DEFAULT 'pending'
                          CHECK (status IN ('pending','checked_in','checked_out','cancelled')),
    checkin_qr_token      TEXT,
    checkin_code          VARCHAR(10),
    checkin_qr_expires_at TIMESTAMP WITH TIME ZONE,
    checkin_at            TIMESTAMP WITH TIME ZONE,
    checkin_admin_id      INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    checkout_qr_token     TEXT,
    checkout_code         VARCHAR(10),
    checkout_qr_expires_at TIMESTAMP WITH TIME ZONE,
    checkout_at           TIMESTAMP WITH TIME ZONE,
    checkout_admin_id     INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    hidden_at             TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`);
console.log("✅ Tabel booking berhasil dibuat");

// TABLE: admin_scan_session
await client.query(`
  CREATE TABLE IF NOT EXISTS admin_scan_session (
    id          SERIAL PRIMARY KEY,
    session_id  UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    admin_id    INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    branch_id   INTEGER NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    scan_type   VARCHAR(20) NOT NULL CHECK (scan_type IN ('checkin','checkout')),
    status      VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','completed','expired')),
    booking_id  INTEGER REFERENCES booking(id) ON DELETE SET NULL,
    result_data JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL
  );
`);
console.log("✅ Tabel admin_scan_session berhasil dibuat");



    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_email ON admin(email);
      CREATE INDEX IF NOT EXISTS idx_admin_branch_id ON admin(branch_id);
      CREATE INDEX IF NOT EXISTS idx_admin_role ON admin(role);
      CREATE INDEX IF NOT EXISTS idx_service_type_branch ON service_type(branch_id);
      CREATE INDEX IF NOT EXISTS idx_service_name_type   ON service_name(service_type_id);
      CREATE INDEX IF NOT EXISTS idx_service_name_branch ON service_name(branch_id);
      CREATE INDEX IF NOT EXISTS idx_room_type_branch    ON room_type(branch_id);
      CREATE INDEX IF NOT EXISTS idx_room_name_type      ON room_name(room_type_id);
      CREATE INDEX IF NOT EXISTS idx_room_name_branch    ON room_name(branch_id);
      CREATE INDEX IF NOT EXISTS idx_staff_branch ON staff(branch_id);
      CREATE INDEX IF NOT EXISTS idx_membership_branch   ON membership(branch_id);
      CREATE INDEX IF NOT EXISTS idx_membership_level    ON membership(branch_id, level);
      CREATE INDEX IF NOT EXISTS idx_benefit_membership  ON membership_benefit(membership_id);
      CREATE INDEX IF NOT EXISTS idx_benefit_service     ON membership_benefit(service_name_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_branch      ON schedule(branch_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_date        ON schedule(date);
      CREATE INDEX IF NOT EXISTS idx_schedule_sn_date     ON schedule(service_name_id, date);
      CREATE INDEX IF NOT EXISTS idx_schedule_room_date   ON schedule(room_name_id, date);
      CREATE INDEX IF NOT EXISTS idx_sched_staff_sch      ON schedule_staff(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_sched_staff_staff    ON schedule_staff(staff_id);
      CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user(email);
      CREATE INDEX IF NOT EXISTS idx_user_membership_user   ON user_membership(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_membership_branch ON user_membership(branch_id);
      CREATE INDEX IF NOT EXISTS idx_payment_user           ON payment_transaction(user_id);
      CREATE INDEX IF NOT EXISTS idx_payment_order          ON payment_transaction(order_id);
      CREATE INDEX IF NOT EXISTS idx_booking_user      ON booking(user_id);
      CREATE INDEX IF NOT EXISTS idx_booking_schedule  ON booking(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_booking_status    ON booking(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_scan_session      ON admin_scan_session(session_id);
    `);
    console.log("✅ Index berhasil dibuat");

    await client.query("COMMIT");
    console.log("🎉 Migrasi database selesai");


  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migrasi gagal:", err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
};

createTables().catch(() => process.exit(1));