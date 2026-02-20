const up = async (pool) => {
  console.log("Creating tables...");

  // Таблица users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      "id" VARCHAR(21) PRIMARY KEY,
      "username" VARCHAR(50) UNIQUE NOT NULL,
      "password" VARCHAR(255) NOT NULL,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Created users table");

  // Таблица sessions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      "sessionId" VARCHAR(32) PRIMARY KEY,
      "userId" VARCHAR(21) REFERENCES users("id") ON DELETE CASCADE,
      "expiresAt" BIGINT NOT NULL,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Created sessions table");

  // Таблица timers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timers (
      "id" VARCHAR(21) PRIMARY KEY,
      "userId" VARCHAR(21) REFERENCES users("id") ON DELETE CASCADE,
      "description" TEXT NOT NULL,
      "start" BIGINT NOT NULL,
      "end" BIGINT,
      "duration" BIGINT,
      "isActive" BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Created timers table");

  // Таблица migrations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR(255) NOT NULL UNIQUE,
      "executedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Created migrations table");

  // Создаем индексы
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions("userId")
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
    ON sessions("expiresAt")
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_timers_user_id
    ON timers("userId")
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_timers_is_active
    ON timers("isActive")
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_timers_user_active
    ON timers("userId", "isActive")
  `);

  console.log("All tables created successfully");
};

const down = async (pool) => {
  console.log("Dropping all tables...");

  await pool.query("DROP TABLE IF EXISTS timers CASCADE");
  await pool.query("DROP TABLE IF EXISTS sessions CASCADE");
  await pool.query("DROP TABLE IF EXISTS users CASCADE");
  await pool.query("DROP TABLE IF EXISTS migrations CASCADE");

  console.log("All tables dropped");
};

exports.up = up;
exports.down = down;
