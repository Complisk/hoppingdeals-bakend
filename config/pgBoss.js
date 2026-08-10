const PgBoss = require("pg-boss");
require("dotenv").config();

let boss = null;
let isStarted = false;

const startPgBoss = async () => {
  if (isStarted && boss) return boss;

  // pg-boss can point at a different connection string than the app.
  // It relies on session features (LISTEN/NOTIFY, advisory locks), so it
  // should keep using the SESSION-mode / direct URL (e.g. Supabase port
  // 5432) even if the app's DATABASE_URL is switched to a transaction-mode
  // pooler (port 6543).
  const bossConnectionString =
    process.env.PG_BOSS_DATABASE_URL || process.env.DATABASE_URL;

  if (!bossConnectionString) {
    console.warn(
      "pg-boss not started: PG_BOSS_DATABASE_URL / DATABASE_URL is not configured",
    );
    return null;
  }

  const monitorStateIntervalSeconds = Math.max(
    1,
    Number(process.env.PG_BOSS_MONITOR_INTERVAL_SECONDS || 30),
  );
  const useSSL = process.env.DB_SSL === "true";

  // Keep this pool small: each open connection occupies one pooler slot in
  // session mode. Default is 10 in pg-boss, which combined with the Sequelize
  // pool can exhaust the pooler's connection limit under load.
  const bossPoolSizeRaw = Number(process.env.PG_BOSS_POOL_SIZE || 3);
  const bossPoolSize = Number.isFinite(bossPoolSizeRaw)
    ? Math.max(1, bossPoolSizeRaw)
    : 3;

  boss = new PgBoss({
    connectionString: bossConnectionString,
    poolSize: bossPoolSize,
    ...(useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {}),
    schema: process.env.PG_BOSS_SCHEMA || "pgboss",
    monitorStateIntervalSeconds,
    archiveCompletedAfterSeconds: 24 * 60 * 60,
    deleteAfterDays: 3,
  });

  console.log(
    `[PG-BOSS] starting with poolSize=${bossPoolSize}, monitorInterval=${monitorStateIntervalSeconds}s`,
  );

  boss.on("error", (error) => {
    console.error("pg-boss error:", error);
  });

  await boss.start();
  isStarted = true;
  console.log("pg-boss started");
  return boss;
};

const getPgBoss = () => boss;

const stopPgBoss = async () => {
  if (!boss) return;
  try {
    await boss.stop();
    console.log("pg-boss stopped");
  } catch (error) {
    console.error("Failed to stop pg-boss:", error);
  } finally {
    boss = null;
    isStarted = false;
  }
};

module.exports = {
  startPgBoss,
  getPgBoss,
  stopPgBoss,
};
