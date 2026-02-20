const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");

const up = async (pool) => {
  console.log("Creating admin user...");

  // Проверяем, существует ли уже пользователь admin
  const result = await pool.query(
    `
    SELECT "id", "username"
    FROM users
    WHERE "username" = $1
  `,
    ["admin"]
  );

  if (result.rows.length === 0) {
    const password = process.env.ADMIN_PASSWORD || "pwd007";
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем пользователя admin
    await pool.query(
      `
      INSERT INTO users ("id", "username", "password")
      VALUES ($1, $2, $3)
    `,
      ["admin_" + Date.now(), "admin", hashedPassword]
    );

    console.log("Admin user created successfully");
    console.log(`Username: admin`);
    console.log(`Password: ${password}`);
  } else {
    console.log("Admin user already exists");
  }
};

const down = async (pool) => {
  console.log("Removing admin user...");
  await pool.query(
    `
    DELETE FROM users
    WHERE "username" = $1
  `,
    ["admin"]
  );
  console.log("Admin user removed");
};

exports.up = up;
exports.down = down;
