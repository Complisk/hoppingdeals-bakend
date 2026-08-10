const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { setupRoutes, setupModelRelationships } = require("./routes/index");

// Initialize app
const app = express();

// Security middleware
app.use(helmet());

const normalizeOrigin = (origin = "") =>
  String(origin).trim().replace(/\/+$/, "").toLowerCase();

const allowedOrigins = [
  "https://complisk.com/",
  "https://www.complisk.com/",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:8081",
];
const allowedOriginSet = new Set(allowedOrigins.map(normalizeOrigin));

// CORS
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (no Origin header)
    if (!origin) return callback(null, true);

    if (allowedOriginSet.has(normalizeOrigin(origin)))
      return callback(null, true);
    console.log(`Blocked CORS request from origin: ${origin}`, allowedOrigins);

    // Block unknown origins (browser will show CORS error)
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.set("trust proxy", true);

// Body parser middleware (except for webhook route)
// Increased limits to handle file uploads and large payloads
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payment/webhook") {
    next();
  } else {
    express.json({ limit: "50mb" })(req, res, next);
  }
});

app.use(express.urlencoded({ limit: "50mb", extended: false }));

// Setup model relationships FIRST (before routes use them)
setupModelRelationships();

// Setup routes AFTER relationships are established
setupRoutes(app);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

module.exports = app;
