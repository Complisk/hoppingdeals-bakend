const crypto = require("crypto");
const { Op } = require("sequelize");

const User = require("../models/User");
const Business = require("../models/Business");
const { sequelize } = require("../config/db");
const { generateToken } = require("../middleware/authMiddleware");
const Role = require("../models/Role");
const {
  sendPasswordResetEmail,
  sendBusinessRegistrationEmails,
} = require("../services/emailService");

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${label} timeout`);
        error.code = "DB_TIMEOUT";
        reject(error);
      }, ms);
    }),
  ]);

const isTransientDbError = (error) =>
  error?.code === "DB_TIMEOUT" ||
  error?.code === "ECONNRESET" ||
  error?.name === "SequelizeConnectionError" ||
  error?.name === "SequelizeConnectionAcquireTimeoutError";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDbOperation = async (
  operation,
  label,
  { timeoutMs = 8000, retries = 1 } = {},
) => {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(
        Promise.resolve().then(operation),
        timeoutMs,
        label,
      );
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === retries) {
        throw error;
      }
      await sleep(300);
    }
  }

  throw lastError;
};

const parseLatLng = ({ lat, lng }) => {
  const numLat = Number(lat);
  const numLng = Number(lng);

  if (Number.isFinite(numLat) && Number.isFinite(numLng)) {
    return { lat: numLat, lng: numLng };
  }

  return { lat: null, lng: null };
};

const buildGeoPoint = ({ lat, lng }) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))
    return null;
  return { type: "Point", coordinates: [Number(lng), Number(lat)] };
};

const PASSWORD_RESET_EXPIRY_MINUTES = Number(
  process.env.PASSWORD_RESET_EXPIRY_MINUTES || 60,
);

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const createClientError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const buildEmailLookupWhere = (normalizedEmail) =>
  sequelize.where(
    sequelize.fn("LOWER", sequelize.col("email")),
    normalizedEmail,
  );

const resolveFrontendBaseUrl = () =>
  process.env.FRONTEND_URL || "http://localhost:8080";

const buildResetUrl = ({ accountType, token }) => {
  const baseUrl = resolveFrontendBaseUrl().replace(/\/+$/, "");
  const path =
    accountType === "business"
      ? "/business/reset-password"
      : "/auth/reset-password";

  return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
};

const buildPasswordResetTokenHash = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const getAccountDisplayName = ({ account, accountType }) => {
  if (accountType === "business") {
    return account?.personName || account?.name || "there";
  }
  return account?.fullName || "there";
};

const findAccountByEmail = async ({
  email,
  preferredAccountType,
  transaction,
} = {}) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return {
      account: null,
      accountType: null,
      userAccount: null,
      businessAccount: null,
    };
  }

  const [userAccount, businessAccount] = await Promise.all([
    User.findOne({
      where: buildEmailLookupWhere(normalizedEmail),
      ...(transaction ? { transaction } : {}),
    }),
    Business.findOne({
      where: buildEmailLookupWhere(normalizedEmail),
      ...(transaction ? { transaction } : {}),
    }),
  ]);

  if (preferredAccountType === "user" && userAccount) {
    return {
      account: userAccount,
      accountType: "user",
      userAccount,
      businessAccount,
    };
  }

  if (preferredAccountType === "business" && businessAccount) {
    return {
      account: businessAccount,
      accountType: "business",
      userAccount,
      businessAccount,
    };
  }

  if (userAccount) {
    return {
      account: userAccount,
      accountType: "user",
      userAccount,
      businessAccount,
    };
  }

  if (businessAccount) {
    return {
      account: businessAccount,
      accountType: "business",
      userAccount,
      businessAccount,
    };
  }

  return {
    account: null,
    accountType: null,
    userAccount,
    businessAccount,
  };
};

const buildPasswordResetWhere = (tokenHash) => ({
  resetPasswordToken: tokenHash,
  resetPasswordExpires: {
    [Op.gt]: new Date(),
  },
});

const findAccountByResetToken = async ({ tokenHash, preferredAccountType }) => {
  const where = buildPasswordResetWhere(tokenHash);

  if (preferredAccountType === "user") {
    const userAccount = await User.findOne({ where });
    if (userAccount) return { account: userAccount, accountType: "user" };

    const businessAccount = await Business.findOne({ where });
    if (businessAccount) {
      return { account: businessAccount, accountType: "business" };
    }

    return { account: null, accountType: null };
  }

  if (preferredAccountType === "business") {
    const businessAccount = await Business.findOne({ where });
    if (businessAccount) {
      return { account: businessAccount, accountType: "business" };
    }

    const userAccount = await User.findOne({ where });
    if (userAccount) return { account: userAccount, accountType: "user" };

    return { account: null, accountType: null };
  }

  const [userAccount, businessAccount] = await Promise.all([
    User.findOne({ where }),
    Business.findOne({ where }),
  ]);

  if (userAccount && businessAccount) {
    return { account: null, accountType: null, isAmbiguous: true };
  }

  if (userAccount) return { account: userAccount, accountType: "user" };
  if (businessAccount)
    return { account: businessAccount, accountType: "business" };

  return { account: null, accountType: null };
};

const withEmailRegistrationLock = async (email, operation) => {
  const normalizedEmail = normalizeEmail(email);

  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:email))", {
      replacements: { email: normalizedEmail },
      transaction,
    });

    return operation({ transaction, normalizedEmail });
  });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { fullName, email, password, timezone } = req.body;

    const user = await runDbOperation(
      () =>
        withEmailRegistrationLock(
          email,
          async ({ transaction, normalizedEmail }) => {
            const { userAccount, businessAccount } = await findAccountByEmail({
              email: normalizedEmail,
              transaction,
            });

            if (userAccount || businessAccount) {
              throw createClientError("Email already exists", 400);
            }

            return User.create(
              {
                fullName,
                email: normalizedEmail,
                password,
                role: "user",
                timezone: timezone || "UTC",
              },
              { transaction },
            );
          },
        ),
      "User registration",
    );

    if (user) {
      res.status(201).json({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        token: generateToken(user.id, "user"),
      });
    }
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error?.name === "SequelizeUniqueConstraintError") {
      return res
        .status(400)
        .json({ message: "Email already exists in user or business account" });
    }

    res.status(500).json({ message: error.message });
  }
};

// @desc    Register new business
// @route   POST /api/auth/register/business
// @access  Public
const registerBusiness = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      categories,
      personName,
      businessAddress,
      placeId,
      lat,
      lng,
      timezone,
    } = req.body;
    const normalizedEmail = normalizeEmail(email);

    console.log(
      `[REGISTER BUSINESS] Request - Name: ${name}, Categories: ${JSON.stringify(
        categories,
      )}`,
    );

    if (!categories || categories.length === 0 || categories.length > 2) {
      return res.status(400).json({
        message: "Please select 1 or 2 business categories",
      });
    }

    const parsedCoords = parseLatLng({ lat, lng });

    const business = await runDbOperation(
      () =>
        withEmailRegistrationLock(email, async ({ transaction }) => {
          const { businessAccount } = await findAccountByEmail({
            email,
            transaction,
          });

          // Only check if business account already exists, allow if email exists in User model
          if (businessAccount) {
            throw createClientError("Email already exists", 400);
          }

          return Business.create(
            {
              name,
              email: normalizedEmail,
              password,
              phone: phone || null,
              categories,
              personName: personName || null,
              businessAddress: businessAddress || null,
              placeId: placeId || null,
              lat: parsedCoords.lat,
              lng: parsedCoords.lng,
              coordinates: buildGeoPoint(parsedCoords),
              autoApprovePromotions: false,
              timezone: timezone || "UTC",
            },
            { transaction },
          );
        }),
      "Business creation",
    );

    console.log(`[REGISTER BUSINESS] Business created - ID: ${business.id}`);

    try {
      const emailResults = await sendBusinessRegistrationEmails({
        business: business?.dataValues,
      });
      console.log(
        "[REGISTER BUSINESS] Registration emails result:",
        emailResults,
      );
    } catch (emailError) {
      console.error(
        `[REGISTER BUSINESS] Failed to send registration emails: ${emailError?.message}`,
      );
    }

    if (business) {
      const responseData = {
        ...business?.dataValues,
        token: generateToken(business.id, "business"),
      };

      console.log(
        `[REGISTER BUSINESS] Response sent for ID: ${responseData.id}`,
      );
      res.status(201).json(responseData);
    }
  } catch (error) {
    console.error(`[REGISTER BUSINESS] Error:`, error.message);

    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (
      error?.code === "DB_TIMEOUT" ||
      error?.code === "ECONNRESET" ||
      error?.name === "SequelizeConnectionError" ||
      error?.name === "SequelizeConnectionAcquireTimeoutError"
    ) {
      return res.status(503).json({
        message:
          "Database connection is unstable right now. Please try again in a few seconds.",
      });
    }

    if (error?.name === "SequelizeValidationError") {
      return res.status(400).json({
        message: "Validation error",
        errors: (error.errors || []).map((e) => ({
          field: e.path,
          message: e.message,
          value: e.value,
        })),
      });
    }

    if (error?.name === "SequelizeUniqueConstraintError") {
      return res
        .status(400)
        .json({ message: "Email already exists in user or business account" });
    }

    res.status(500).json({ message: error.message });
  }
};

// @desc    Login user/business/admin
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const [userAccount, businessAccount] = await Promise.all([
      User.findOne({
        where: buildEmailLookupWhere(email),
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["id", "name", "permissions"],
          },
        ],
      }),
      Business.findOne({
        where: buildEmailLookupWhere(email),
      }),
    ]);

    console.log({ userAccount, businessAccount }, "check business and user account please");

    // Priority: If email exists in Business model, respond as business first
    if (businessAccount) {
      if (["blocked", "suspended"].includes(businessAccount.status)) {
        return res.status(403).json({ message: "Account is blocked" });
      }

      const isMatch = await businessAccount.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = generateToken(businessAccount.id, "business");
      return res.json({
        ...businessAccount?.dataValues,
        token,
        accountType: "business",
      });
    }

    // If no business account, check for user/admin account
    if (userAccount) {
      if (["blocked", "suspended"].includes(userAccount.status)) {
        return res.status(403).json({ message: "Account is blocked" });
      }

      const isMatch = await userAccount.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isAdminAccount =
        userAccount.accountType === "admin" ||
        Boolean(userAccount.isSuperAdmin);

      if (isAdminAccount) {
        const token = generateToken(userAccount.id, "admin");
        const response = {
          id: userAccount.id,
          email: userAccount.email,
          token,
          fullName: userAccount.fullName,
          avatarUrl: userAccount.avatarUrl,
          timezone: userAccount.timezone || "UTC",
          isSuperAdmin: userAccount.isSuperAdmin,
          accountType: "admin",
        };

        if (userAccount.isSuperAdmin) {
          response.role = {
            name: "SuperAdmin",
            permissions: "ALL",
          };
        } else {
          response.role = userAccount.role
            ? {
                id: userAccount.role.id,
                name: userAccount.role.name,
                permissions: userAccount.role.permissions,
              }
            : null;
        }

        return res.json(response);
      }

      const token = generateToken(userAccount.id, "user");
      return res.json({
        id: userAccount.id,
        email: userAccount.email,
        token,
        fullName: userAccount.fullName,
        avatarUrl: userAccount.avatarUrl,
        timezone: userAccount.timezone || "UTC",
        role: "user",
        accountType: "user",
      });
    }

    // Account not found
    return res.status(404).json({ message: "Account not found. Please register first." });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: error?.message });
  }
};

// @desc    Request password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    const { account, accountType: resolvedAccountType } =
      await findAccountByEmail({
        email,
      });

    if (!account) {
      return res.status(200).json({
        message:
          "If that email is registered, a password reset link has been sent.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetPasswordToken = buildPasswordResetTokenHash(resetToken);
    const resetPasswordExpires = new Date(
      Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
    );

    account.resetPasswordToken = resetPasswordToken;
    account.resetPasswordExpires = resetPasswordExpires;
    await account.save({
      fields: ["resetPasswordToken", "resetPasswordExpires"],
    });

    const resetUrl = buildResetUrl({
      accountType: resolvedAccountType,
      token: resetToken,
    });

    try {
      await sendPasswordResetEmail({
        to: account.email,
        displayName: getAccountDisplayName({
          account,
          accountType: resolvedAccountType,
        }),
        accountType: resolvedAccountType,
        resetUrl,
        expiresInMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
      });
    } catch (emailError) {
      console.error("Forgot password email error:", emailError?.message);
    }

    return res.status(200).json({
      message:
        "If that email is registered, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: error?.message });
  }
};

// @desc    Reset password with token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = req.body?.password;
    const tokenHash = buildPasswordResetTokenHash(token);
    const {
      account,
      accountType: resolvedAccountType,
      isAmbiguous,
    } = await findAccountByResetToken({
      tokenHash,
    });

    if (isAmbiguous) {
      return res.status(409).json({
        message:
          "This reset token matches multiple accounts. Please request a new password reset link.",
      });
    }

    if (!account || !resolvedAccountType) {
      return res.status(400).json({
        message: "Invalid or expired password reset token",
      });
    }

    account.password = password;
    account.resetPasswordToken = null;
    account.resetPasswordExpires = null;

    await account.save({
      fields: ["password", "resetPasswordToken", "resetPasswordExpires"],
    });

    return res.status(200).json({
      message: `Password has been reset successfully for ${resolvedAccountType} account`,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: error?.message });
  }
};

module.exports = {
  registerUser,
  registerBusiness,
  login,
  forgotPassword,
  resetPassword,
};
