// Отключение debug-сообщений dotenv
const originalConsoleLog = console.log;
console.log = () => {};
require("dotenv").config();
console.log = originalConsoleLog;

const express = require("express");
const nunjucks = require("nunjucks");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const fs = require("fs").promises;
const path = require("path");
const http = require("http");
const { nanoid } = require("nanoid");

const { pool, db } = require("./database");
const { loadUserFromSession, requireAuthForAPI, setShuttingDown } = require("./auth");
const WebSocketManager = require("./websocket");

let isShuttingDown = false;

const migrationsTableCheck = `
  CREATE TABLE IF NOT EXISTS migrations (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL UNIQUE,
    "executedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

const getExecutedMigrations = async () => {
  await pool.query(migrationsTableCheck);
  const result = await pool.query('SELECT "name" FROM migrations ORDER BY "id"');
  return result.rows.map((row) => row.name);
};

const executeMigration = async (migrationName, migrationFunction) => {
  await migrationFunction(pool);
  await pool.query('INSERT INTO migrations ("name") VALUES ($1)', [migrationName]);
};

const runMigrations = async () => {
  console.log("Checking for pending migrations...");

  try {
    const migrationsDir = path.join(__dirname, "migrations");
    const files = await fs.readdir(migrationsDir);
    const migrationFiles = files.filter((f) => f.endsWith(".js")).sort();

    const executedMigrations = await getExecutedMigrations();

    for (const file of migrationFiles) {
      if (!executedMigrations.includes(file)) {
        const migrationPath = path.join(migrationsDir, file);
        const migration = require(migrationPath);

        if (typeof migration.up !== "function") {
          throw new Error(`Migration ${file} doesn't export 'up' function`);
        }

        await executeMigration(file, migration.up);
        console.log(`Migration ${file} completed`);
      }
    }

    console.log("All migrations are up to date");
    return true;
  } catch (error) {
    console.error("Migration failed:", error.message);
    throw error;
  }
};

const app = express();
const server = http.createServer(app);

const wsManager = new WebSocketManager(server);

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

app.get("/", loadUserFromSession, (req, res) => {
  res.render("index", {
    user: res.locals.user,
    sessionId: req.cookies.sessionId,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    console.log("Login failed: Missing credentials");
    return res.redirect("/?authError=Username and password required");
  }

  try {
    const user = await db.findUserByUsername(username);

    if (!user) {
      console.log(`Login failed: User ${username} not found`);
      return res.redirect("/?authError=true");
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log(`Login failed: Invalid password for ${username}`);
      return res.redirect("/?authError=true");
    }

    const sessionId = nanoid(32);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await db.createSession(sessionId, user.id, expiresAt);

    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    res.redirect("/");
  } catch (error) {
    console.error("Login error:", error);
    res.redirect("/?authError=Login failed");
  }
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    console.log("Signup failed: Missing credentials");
    return res.redirect("/?authError=Username and password required");
  }

  try {
    const existingUser = await db.findUserByUsername(username);

    if (existingUser) {
      console.log(`Signup failed: Username ${username} already exists`);
      return res.redirect("/?authError=Username already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await db.createUser(username, hashedPassword);
    console.log(`User created: ${username} (${newUser.id})`);

    const sessionId = nanoid(32);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await db.createSession(sessionId, newUser.id, expiresAt);

    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    console.log(`Signup successful, session created for ${username}`);
    res.redirect("/");
  } catch (error) {
    console.error("Signup error:", error);
    res.redirect("/?authError=Registration failed");
  }
});

app.get("/logout", async (req, res) => {
  const sessionId = req.cookies.sessionId;

  if (sessionId) {
    try {
      await db.deleteSession(sessionId);
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  }

  res.clearCookie("sessionId");
  res.redirect("/");
});

app.get("/api/timers", requireAuthForAPI, async (req, res) => {
  const isActive = req.query.isActive;
  console.log(`API GET /api/timers?isActive=${isActive} for user ${req.user.id}`);

  try {
    const timers = await db.getTimers(req.user.id, isActive);
    //console.log(`Found ${timers.length} timers`);
    res.json(timers);
  } catch (error) {
    console.error("Error getting timers:", error);
    res.status(500).json({ error: "Failed to get timers" });
  }
});

app.post("/api/timers", requireAuthForAPI, async (req, res) => {
  const { description } = req.body;

  if (!description || description.trim() === "") {
    console.log("Timer creation failed: Description is required");
    return res.status(400).json({ error: "Description is required" });
  }

  try {
    const newTimer = await db.createTimer(req.user.id, description.trim());

    await wsManager.notifyTimerCreated(req.user.id);
    console.log("WebSocket notification sent for timer creation");

    res.status(201).json({ id: newTimer.id });
  } catch (error) {
    console.error("Error creating timer:", error);
    res.status(500).json({ error: "Failed to create timer" });
  }
});

app.post("/api/timers/:id/stop", requireAuthForAPI, async (req, res) => {
  const timerId = req.params.id;

  try {
    const timer = await db.getTimerById(timerId, req.user.id);

    if (!timer) {
      console.log(`Timer ${timerId} not found`);
      return res.status(404).json({ error: "Timer not found" });
    }

    if (!timer.isActive) {
      console.log(`Timer ${timerId} is already stopped`);
      return res.status(400).json({ error: "Timer is already stopped" });
    }

    const stoppedTimer = await db.stopTimer(timerId, req.user.id);

    await wsManager.notifyTimerStopped(req.user.id);
    console.log("WebSocket notification sent for timer stop");

    res.json({});
  } catch (error) {
    console.error("Error stopping timer:", error);
    res.status(500).json({ error: "Failed to stop timer" });
  }
});

const port = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Database connection established");

    await runMigrations();

    server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
      console.log(`WebSocket server running on ws://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

process.on("SIGINT", async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  setShuttingDown(true);

  console.log("\nShutting down...");

  wsManager.shutdown();
  console.log("WebSocket server closed");

  await pool.end();
  console.log("Database connections closed");

  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  setShuttingDown(true);

  console.log("\nTerminating...");

  wsManager.shutdown();
  console.log("WebSocket server closed");

  await pool.end();
  console.log("Database connections closed");

  process.exit(0);
});
