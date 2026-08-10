const { Sequelize } = require("sequelize");
require("dotenv").config();

// Force pg to be bundled by Vercel.
const pg = require("pg");

const parseEnvNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOptionalEnvNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const isSslEnabled = process.env.DB_SSL === "true";
const dbStatementTimeoutMs = parseOptionalEnvNumber(
  process.env.DB_STATEMENT_TIMEOUT_MS,
);
const dbQueryTimeoutMs = parseOptionalEnvNumber(process.env.DB_QUERY_TIMEOUT_MS);
const dbConnectionTimeoutMs = parseEnvNumber(
  process.env.DB_CONNECTION_TIMEOUT_MS,
  20000,
);

// Connection budget for the DB pool.
// IMPORTANT: If you use a managed Postgres connection pooler in SESSION mode
// (e.g. Supabase Supavisor on port 5432), every open connection occupies a
// pooler slot for its whole lifetime. Keep this pool small AND keep the
// pg-boss pool (config/pgBoss.js) small too, so their combined total stays
// well below the pooler's connection limit (e.g. 15).
const dbPoolMax = parseEnvNumber(process.env.DB_POOL_MAX, 5);
const dbPoolMin = parseEnvNumber(process.env.DB_POOL_MIN, 0);
const dbPoolAcquireMs = parseEnvNumber(process.env.DB_POOL_ACQUIRE_MS, 30000);
const dbPoolIdleMs = parseEnvNumber(process.env.DB_POOL_IDLE_MS, 10000);
const dbPoolMaxUses = parseOptionalEnvNumber(process.env.DB_POOL_MAX_USES);

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectModule: pg,
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  pool: {
    max: dbPoolMax,
    min: dbPoolMin,
    acquire: dbPoolAcquireMs,
    idle: dbPoolIdleMs,
    // Recycle connections after N queries to avoid stale/broken connections.
    ...(dbPoolMaxUses ? { maxUses: dbPoolMaxUses } : {}),
  },
  dialectOptions: {
    ssl: isSslEnabled ? { require: true, rejectUnauthorized: false } : false,
    keepAlive: true,
    connectionTimeoutMillis: dbConnectionTimeoutMs,
    ...(dbStatementTimeoutMs
      ? { statement_timeout: dbStatementTimeoutMs }
      : {}),
    ...(dbQueryTimeoutMs ? { query_timeout: dbQueryTimeoutMs } : {}),
  },
});

const connectDB = async () => {
  try {
    await sequelize.authenticate();

    const shouldSyncAlter =
      process.env.NODE_ENV === "development" &&
      process.env.DB_SYNC_ALTER === "true" &&
      false;

    // Only run altering sync when explicitly enabled in development.
    if (shouldSyncAlter) {
      // await sequelize.sync({ alter: true });
      // console.log("Database synchronized (alter mode)");
    }

    console.log("PostgreSQL connected successfully");
    console.log(
      `[DB POOL] max=${dbPoolMax}, min=${dbPoolMin}, acquire=${dbPoolAcquireMs}ms, idle=${dbPoolIdleMs}ms, maxUses=${dbPoolMaxUses || "default"}, statementTimeout=${dbStatementTimeoutMs || "none"}, queryTimeout=${dbQueryTimeoutMs || "none"}`,
    );
  } catch (error) {
    console.error("Unable to connect to database", error);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
