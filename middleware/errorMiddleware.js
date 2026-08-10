// Not Found middleware
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

// Detect database connection exhaustion / pooler limits (e.g. Supabase
// Supavisor "(EMAXCONNSESSION) max clients reached in session mode").
const isConnectionExhaustedError = (err) => {
  const message = String(err?.message || "");
  return (
    message.includes("max clients reached") ||
    message.includes("EMAXCONNSESSION") ||
    message.includes("too many clients") ||
    err?.name === "SequelizeConnectionAcquireTimeoutError" ||
    err?.name === "SequelizeTimeoutError"
  );
};

// Error Handler middleware
const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err?.message || "Server error";

  if (err?.name === "MulterError") {
    statusCode = 400;
    if (err?.code === "LIMIT_FILE_SIZE") {
      message = "File too large. Maximum allowed size is 2MB per image.";
    }
  }
  if (statusCode === 500 && /only image files allowed/i.test(err?.message || "")) {
    statusCode = 400;
  }
  if (isConnectionExhaustedError(err)) {
    statusCode = 503;
    message =
      "Server is busy right now. Please try again in a few seconds.";
  }

  res.status(statusCode).json({
    message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    errors: err.errors || null
  });
};

module.exports = { notFound, errorHandler };
