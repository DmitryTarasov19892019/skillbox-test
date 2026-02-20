const { Pool } = require("pg");
const { nanoid } = require("nanoid");

const getPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    };
  }

  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl:
      process.env.PGSSLMODE === "require"
        ? {
            rejectUnauthorized: false,
          }
        : false,
  };
};

const pool = new Pool(getPoolConfig());

pool.first = async function (text, params) {
  const result = await this.query(text, params);
  return result.rows[0] || null;
};

const db = {
  // Users
  async createUser(username, hashedPassword) {
    const id = nanoid();
    const query = `
      INSERT INTO users ("id", "username", "password")
      VALUES ($1, $2, $3)
      RETURNING "id", "username"
    `;
    const result = await pool.query(query, [id, username, hashedPassword]);
    return result.rows[0];
  },

  async findUserByUsername(username) {
    const query = 'SELECT * FROM users WHERE "username" = $1';
    const user = await pool.first(query, [username]);
    return user;
  },

  async findUserById(userId) {
    const query = 'SELECT * FROM users WHERE "id" = $1';
    const user = await pool.first(query, [userId]);
    return user;
  },

  // Sessions
  async createSession(sessionId, userId, expiresAt) {
    const query = `
      INSERT INTO sessions ("sessionId", "userId", "expiresAt")
      VALUES ($1, $2, $3)
    `;
    await pool.query(query, [sessionId, userId, expiresAt]);
  },

  async findSession(sessionId) {
    const query = `
      SELECT s.*, u."username"
      FROM sessions s
      JOIN users u ON s."userId" = u."id"
      WHERE s."sessionId" = $1 AND s."expiresAt" > $2
    `;
    const session = await pool.first(query, [sessionId, Date.now()]);
    return session;
  },

  async updateSessionExpiry(sessionId, expiresAt) {
    const query = `
      UPDATE sessions
      SET "expiresAt" = $1
      WHERE "sessionId" = $2
    `;
    await pool.query(query, [expiresAt, sessionId]);
  },

  async deleteSession(sessionId) {
    const query = 'DELETE FROM sessions WHERE "sessionId" = $1';
    await pool.query(query, [sessionId]);
  },

  async cleanupExpiredSessions() {
    const query = 'DELETE FROM sessions WHERE "expiresAt" <= $1';
    const result = await pool.query(query, [Date.now()]);
    if (result.rowCount > 0) {
      console.log(`Removed ${result.rowCount} expired sessions`);
    }
  },

  // Timers
  async createTimer(userId, description) {
    const id = nanoid();
    const start = Date.now();
    const query = `
      INSERT INTO timers ("id", "userId", "description", "start", "isActive")
      VALUES ($1, $2, $3, $4, true)
      RETURNING "id", "start"::bigint as "start"
    `;
    const result = await pool.query(query, [id, userId, description, start]);
    return result.rows[0];
  },

  async stopTimer(timerId, userId) {
    const now = Date.now();
    const query = `
      UPDATE timers
      SET
        "isActive" = false,
        "end" = $1,
        "duration" = $1 - "start"
      WHERE "id" = $2 AND "userId" = $3 AND "isActive" = true
      RETURNING "id", "description", "start"::bigint as "start", "end"::bigint as "end", "duration"::bigint as "duration"
    `;
    const result = await pool.first(query, [now, timerId, userId]);
    if (result) {
    }
    return result;
  },

  async getTimers(userId, isActive) {
    let query;
    let params;

    if (isActive === "true") {
      query = `
        SELECT
          "id",
          "description",
          "start"::bigint as "start",
          "isActive"
        FROM timers
        WHERE "userId" = $1 AND "isActive" = true
        ORDER BY "start" DESC
      `;
      params = [userId];
    } else if (isActive === "false") {
      query = `
        SELECT
          "id",
          "description",
          "start"::bigint as "start",
          "end"::bigint as "end",
          "duration"::bigint as "duration",
          "isActive"
        FROM timers
        WHERE "userId" = $1 AND "isActive" = false
        ORDER BY "start" DESC
      `;
      params = [userId];
    } else {
      return [];
    }

    const result = await pool.query(query, params);
    const now = Date.now();

    return result.rows.map((timer) => {
      const timerData = {
        id: timer.id,
        description: timer.description,
        start: Number(timer.start),
        isActive: timer.isActive,
      };

      if (timer.isActive) {
        timerData.progress = now - timerData.start;
      } else {
        timerData.end = Number(timer.end);
        timerData.duration = Number(timer.duration);
      }

      return timerData;
    });
  },

  async getTimerById(timerId, userId) {
    const query = 'SELECT * FROM timers WHERE "id" = $1 AND "userId" = $2';
    const timer = await pool.first(query, [timerId, userId]);
    return timer;
  },

  async getAllActiveTimers() {
    const query = `
      SELECT
        "id",
        "userId",
        "description",
        "start"::bigint as "start",
        "isActive"
      FROM timers
      WHERE "isActive" = true
    `;
    const result = await pool.query(query);
    return result.rows;
  },
};

module.exports = {
  pool,
  db,
};
