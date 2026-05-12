const User = require("../models/User");
const Business = require("../models/Business");
const BusinessSubscription = require("../models/BusinessSubscription");
const Role = require("../models/Role");
const Promotion = require("../models/Promotion");
const PromotionLocation = require("../models/PromotionLocation");
const Template = require("../models/Template");
const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const { Op } = require("sequelize");
const { uploadImageToCloudinary } = require("../utils/cloudinaryUtils");
const {
  syncPromotionLocations,
  getPromotionLocationAttributes,
} = require("../utils/promotionLocationUtils");
const {
  parseBoolean,
  resolveScheduleTimezone,
  buildSchedulePayload,
  ensureValidScheduleWindow,
  ensureNoScheduledOverlap,
} = require("../utils/promotionScheduleUtils");
const {
  reschedulePromotionJobs,
  cancelPromotionJobs,
} = require("../services/promotionScheduler");

const extractLatLng = (coordinates) => {
  const value = coordinates?.coordinates;
  if (!Array.isArray(value) || value.length < 2) {
    return { lat: null, lng: null };
  }

  const [lng, lat] = value;
  return {
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
  };
};

const buildLegacyLocationShape = (locations = []) => {
  const cities = [];
  const states = [];
  const timezones = [];
  const citySet = new Set();
  const stateSet = new Set();
  const timezoneSet = new Set();

  for (const loc of locations) {
    if (!loc) continue;

    if (loc.type === "city" && loc.city_name) {
      const cityKey = `${loc.city_name}|${loc.state_code || ""}|${loc.country_code || ""}`;
      if (!citySet.has(cityKey)) {
        citySet.add(cityKey);
        const cityCoords = extractLatLng(loc.coordinates);
        cities.push({
          id: loc.id,
          placeId: null,
          name: loc.city_name,
          state_code: loc.state_code || null,
          state_name: loc.state_name || null,
          country_code: loc.country_code || null,
          country_name: null,
          formattedAddress: null,
          lat: cityCoords.lat,
          lng: cityCoords.lng,
        });
      }
    }

    if (loc.type === "state" && loc.state_code) {
      const stateKey = `${loc.state_code}|${loc.country_code || ""}`;
      if (!stateSet.has(stateKey)) {
        stateSet.add(stateKey);
        const stateCoords = extractLatLng(loc.coordinates);
        states.push({
          id: loc.id,
          placeId: null,
          name: loc.state_name || loc.state_code,
          state_code: loc.state_code,
          state_name: loc.state_name || loc.state_code || null,
          country_code: loc.country_code || null,
          country_name: null,
          formattedAddress: null,
          lat: stateCoords.lat,
          lng: stateCoords.lng,
        });
      }
    }

    if (loc.type === "timezone" && loc.timezone) {
      if (!timezoneSet.has(loc.timezone)) {
        timezoneSet.add(loc.timezone);
        timezones.push(loc.timezone);
      }
    }
  }

  return { cities, states, timezones };
};

const normalizePromotionForFrontend = (promotion) => {
  const plain = promotion?.toJSON ? promotion.toJSON() : promotion;
  if (!plain) return plain;

  const legacy = buildLegacyLocationShape(plain.locations || []);
  return {
    ...plain,
    cities:
      Array.isArray(plain.cities) && plain.cities.length
        ? plain.cities
        : legacy.cities,
    states:
      Array.isArray(plain.states) && plain.states.length
        ? plain.states
        : legacy.states,
    timezones:
      Array.isArray(plain.timezones) && plain.timezones.length
        ? plain.timezones
        : legacy.timezones,
  };
};

const getPromotionWithRelations = async (promotionId) => {
  const locationAttributes = await getPromotionLocationAttributes();

  return Promotion.findByPk(promotionId, {
    include: [
      {
        model: Business,
        as: "business",
        attributes: ["id", "name", "email", "autoApprovePromotions", "status"],
        required: false,
      },
      {
        model: PromotionLocation,
        as: "locations",
        attributes: locationAttributes,
        required: false,
      },
    ],
  });
};

const parseDateOnly = (value) => {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return new Date(Date.UTC(year, month, day));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
};

const isPromotionPastStopDate = (stopDateValue) => {
  const stopDate = parseDateOnly(stopDateValue);
  if (!stopDate) return false;

  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return stopDate < todayUtc;
};

const calculateDurationMonths = (runDate, stopDate) => {
  const start = new Date(runDate);
  const end = new Date(stopDate);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return 1;
  }

  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1
  );
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeTemplateId = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return UUID_REGEX.test(normalized) ? normalized : null;
};

const getRequestTimezone = (req) =>
  String(
    req.headers["x-timezone"] || req.headers["x-user-timezone"] || "",
  ).trim();

const buildBusinessWhereClause = ({ search, status, autoApprove }) => {
  const where = {};

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (autoApprove !== undefined && autoApprove !== null && autoApprove !== "") {
    where.autoApprovePromotions = String(autoApprove).toLowerCase() === "true";
  }

  return where;
};

const escapeCsvCell = (value) => {
  const cell = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientDbTimeoutError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.name === "SequelizeConnectionAcquireTimeoutError" ||
    error?.name === "SequelizeConnectionError" ||
    error?.code === "ECONNRESET" ||
    message.includes("query read timeout")
  );
};

const runWithDbRetry = async (operation, retries = 1) => {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbTimeoutError(error) || attempt === retries) {
        throw error;
      }
      await sleep(300);
    }
  }
  throw lastError;
};

// @desc    Get all users with filters
// @route   GET /api/admin/users
// @access  Private (Admin)
const getAllUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 10 } = req.query;

    const where = {};

    // Search by name or email
    if (search) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Filter by role (user, business, admin)
    if (role) {
      where.accountType = role;
    }

    // Filter by status (active, inactive, blocked, suspended)
    if (status) {
      where.status = status;
    }

    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      users,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// @desc    Get all businesses with filters
// @route   GET /api/admin/businesses
// @access  Private (Admin)
const getAllBusinesses = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10, autoApprove } = req.query;
    const where = buildBusinessWhereClause({ search, status, autoApprove });

    const offset = (page - 1) * limit;

    const { count, rows: businesses } = await Business.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const businessIds = businesses.map((row) => row.id).filter(Boolean);
    const activeSubscriptionByBusinessId = new Map();

    if (businessIds.length) {
      const now = new Date();
      const activeSubscriptions = await BusinessSubscription.findAll({
        where: {
          businessId: { [Op.in]: businessIds },
          status: "active",
        },
        include: [
          {
            model: SubscriptionTemplate,
            as: "template",
          },
        ],
        order: [["endDate", "DESC"]],
      });

      const expiredIds = [];
      for (const sub of activeSubscriptions) {
        const endDate = sub?.endDate ? new Date(sub.endDate) : null;
        const isExpired =
          endDate && !Number.isNaN(endDate.getTime()) && endDate < now;
        if (isExpired) {
          expiredIds.push(sub.id);
          continue;
        }

        if (!activeSubscriptionByBusinessId.has(sub.businessId)) {
          activeSubscriptionByBusinessId.set(sub.businessId, sub);
        }
      }

      if (expiredIds.length) {
        await BusinessSubscription.update(
          { status: "expired" },
          { where: { id: { [Op.in]: expiredIds } } },
        );
      }
    }

    res.json({
      businesses: businesses.map((row) => {
        const plain = row?.toJSON ? row.toJSON() : row;
        const sub = activeSubscriptionByBusinessId.get(row.id);
        return {
          ...plain,
          activeSubscription: sub ? (sub.toJSON ? sub.toJSON() : sub) : null,
        };
      }),
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Export businesses as CSV
// @route   GET /api/admin/businesses/export
// @access  Private (Admin)
const exportBusinessesCsv = async (req, res) => {
  try {
    const { search, status, autoApprove, limit } = req.query;
    const where = buildBusinessWhereClause({ search, status, autoApprove });
    const parsedLimit = Number(limit);
    const exportLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), 10000)
        : null;

    const businesses = await Business.findAll({
      where,
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
      ...(exportLimit ? { limit: exportLimit } : {}),
    });

    const header = [
      "id",
      "name",
      "email",
      "phone",
      "categories",
      "personName",
      "businessAddress",
      "state",
      "timezone",
      "autoApprovePromotions",
      "status",
      "placeId",
      "lat",
      "lng",
      "logoUrl",
      "createdAt",
      "updatedAt",
    ];

    const lines = [header.join(",")];
    for (const business of businesses) {
      const row = business?.toJSON ? business.toJSON() : business;
      const categories = Array.isArray(row?.categories)
        ? row.categories.join("|")
        : "";

      const values = [
        row.id,
        row.name,
        row.email,
        row.phone,
        categories,
        row.personName,
        row.businessAddress,
        row.state,
        row.timezone,
        row.autoApprovePromotions,
        row.status,
        row.placeId,
        row.lat,
        row.lng,
        row.logoUrl,
        row.createdAt ? new Date(row.createdAt).toISOString() : "",
        row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
      ].map(escapeCsvCell);

      lines.push(values.join(","));
    }

    const csv = lines.join("\n");
    const fileName = `businesses-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Export failed" });
  }
};

// @desc    Add or extend a business subscription (admin, free)
// @route   POST /api/admin/businesses/:id/subscription
// @access  Private (Admin)
const grantBusinessSubscription = async (req, res) => {
  try {
    const businessId = req.params.id;
    const { templateId, extendMonths } = req.body || {};

    const business = await Business.findByPk(businessId);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const now = new Date();
    const existingActive = await BusinessSubscription.findOne({
      where: {
        businessId,
        status: "active",
      },
      order: [["endDate", "DESC"]],
    });

    const currentEnd = existingActive?.endDate
      ? new Date(existingActive.endDate)
      : null;
    const existingEndIsValid =
      currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > now;

    // If an "active" record is actually expired, mark it expired and treat as no subscription.
    if (existingActive && !existingEndIsValid) {
      existingActive.status = "expired";
      await existingActive.save({ fields: ["status", "updatedAt"] });
    }

    let subscription = null;

    // ✅ Extend existing subscription by only updating its endDate.
    if (existingActive && existingEndIsValid) {
      const monthsToExtend = Number(extendMonths);
      if (!Number.isFinite(monthsToExtend) || monthsToExtend <= 0) {
        return res.status(400).json({
          message: "extendMonths is required (positive number) to extend",
        });
      }

      const newEnd = new Date(currentEnd);
      newEnd.setMonth(newEnd.getMonth() + monthsToExtend);

      existingActive.endDate = newEnd;
      await existingActive.save({ fields: ["endDate", "updatedAt"] });
      subscription = existingActive;
    } else {
      // ✅ No active subscription: create a new one from template dropdown.
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }

      const template = await SubscriptionTemplate.findByPk(templateId);
      if (!template || template.isActive === false) {
        return res.status(404).json({ message: "Invalid subscription plan" });
      }

      await BusinessSubscription.update(
        { status: "expired" },
        { where: { businessId, status: "active" } },
      );

      const endDate = new Date(now);
      endDate.setMonth(
        endDate.getMonth() + Number(template.durationMonths || 0),
      );

      subscription = await BusinessSubscription.create({
        businessId,
        subscriptionTemplateId: template.id,
        startDate: now,
        endDate,
        freeCities: template.freeCities,
        freeStates: template.freeStates,
        freeTimezones: template.freeTimezones,
        stripeSubscriptionId: null,
        status: "active",
      });
    }

    const hydrated = await BusinessSubscription.findByPk(subscription.id, {
      include: [
        {
          model: SubscriptionTemplate,
          as: "template",
        },
      ],
    });

    res.json({
      message: "Subscription updated successfully",
      subscription: hydrated || subscription,
    });
  } catch (error) {
    console.error("Error granting subscription:", error);
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// @desc    Update user status
// @route   PUT /api/admin/users/:id/status
// @access  Private (Admin)
const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["active", "inactive", "blocked", "suspended"].includes(status)) {
      return res.status(400).json({
        message:
          "Invalid status. Must be one of: active, inactive, blocked, suspended",
      });
    }

    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldStatus = user.status;
    user.status = status;
    await user.save();

    res.json({
      message: `User status updated from ${oldStatus} to ${status}`,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update business status
// @route   PUT /api/admin/businesses/:id/status
// @access  Private (Admin)
const updateBusinessStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["active", "inactive", "blocked", "suspended"].includes(status)) {
      return res.status(400).json({
        message:
          "Invalid status. Must be one of: active, inactive, blocked, suspended",
      });
    }

    const business = await Business.findByPk(req.params.id);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const oldStatus = business.status;
    business.status = status;
    await business.save();

    res.json({
      message: `Business status updated from ${oldStatus} to ${status}`,
      business: {
        id: business.id,
        name: business.name,
        email: business.email,
        status: business.status,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Block/Unblock business (deprecated - use updateBusinessStatus instead)
// @route   PUT /api/admin/businesses/:id/block
// @access  Private (Admin)

// @desc    Get all promotions with filters
// @route   GET /api/admin/promotions
// @access  Private (Admin)
const getAllPromotions = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;

    const where = {};

    // Filter by promotion status (active, inactive, pending)
    if (status) {
      where.status = status;
    }

    // Search by business name or category
    let businessWhere = {};
    if (search) {
      businessWhere = {
        [Op.or]: [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
        ],
      };
    }

    const locationAttributes = await getPromotionLocationAttributes();

    const offset = (page - 1) * limit;

    const { count, rows: promotions } = await Promotion.findAndCountAll({
      where,
      include: [
        {
          model: Business,
          as: "business",
          attributes: [
            "id",
            "name",
            "email",
            "autoApprovePromotions",
            "status",
          ],
          where:
            Object.keys(businessWhere).length > 0 ? businessWhere : undefined,
        },
        {
          model: PromotionLocation,
          as: "locations",
          attributes: locationAttributes,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      distinct: true,
    });

    res.json({
      promotions,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete promotion (admin)
// @route   DELETE /api/admin/promotions/:id
// @access  Private (Admin)
const deletePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByPk(req.params.id);

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    await cancelPromotionJobs(promotion);
    await promotion.destroy();

    res.json({ message: "Promotion deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get admin dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getAdminDashboard = async (req, res) => {
  try {
    // User statistics
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { status: "active" } });
    const blockedUsers = await User.count({ where: { status: "blocked" } });
    const suspendedUsers = await User.count({ where: { status: "suspended" } });

    // Business statistics
    const totalBusinesses = await Business.count();
    const activeBusinesses = await Business.count({
      where: { status: "active" },
    });
    const blockedBusinesses = await Business.count({
      where: { status: "blocked" },
    });
    const businessesWithAutoApprove = await Business.count({
      where: { autoApprovePromotions: true },
    });

    // Promotion statistics
    const totalPromotions = await Promotion.count();
    const activePromotions = await Promotion.count({
      where: { status: "active" },
    });
    const pendingPromotions = await Promotion.count({
      where: { status: "pending" },
    });
    const inactivePromotions = await Promotion.count({
      where: { status: "inactive" },
    });

    // Revenue statistics (total price of active/completed promotions)
    const totalRevenue = await Promotion.sum("price", {
      where: { status: "active" },
    });

    // Engagement metrics
    const totalViews = await Promotion.sum("views");
    const totalClicks = await Promotion.sum("clicks");

    // Recent activity
    const recentUsers = await User.findAll({
      attributes: [
        "id",
        "fullName",
        "email",
        "accountType",
        "isSuperAdmin",
        "status",
        "createdAt",
      ],
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["id", "name"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 5,
    });

    const recentPromotions = await Promotion.findAll({
      attributes: [
        "id",
        "businessId",
        "status",
        "price",
        "createdAt",
        "views",
        "clicks",
      ],
      include: [
        {
          model: Business,
          as: "business",
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 5,
    });

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        blocked: blockedUsers,
        suspended: suspendedUsers,
      },
      businesses: {
        total: totalBusinesses,
        active: activeBusinesses,
        blocked: blockedBusinesses,
        withAutoApprove: businessesWithAutoApprove,
      },
      promotions: {
        total: totalPromotions,
        active: activePromotions,
        pending: pendingPromotions,
        inactive: inactivePromotions,
      },
      revenue: {
        total: parseFloat(totalRevenue) || 0,
      },
      engagement: {
        totalViews: totalViews || 0,
        totalClicks: totalClicks || 0,
        clickThroughRate: totalViews
          ? (((totalClicks || 0) / totalViews) * 100).toFixed(2)
          : 0,
      },
      recentActivity: {
        users: recentUsers.map((user) => ({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.isSuperAdmin
            ? "Super Admin"
            : user.role?.name || user.accountType || "user",
          status: user.status,
          createdAt: user.createdAt,
        })),
        promotions: recentPromotions,
      },
    });
  } catch (error) {
    console.error("Error fetching admin dashboard:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Save template with Cloudinary URL
// @route   POST /api/admin/templates/save
// @access  Private (Admin)
const saveTemplateImage = async (req, res) => {
  try {
    const { name, imageUrl, cloudinaryPublicId } = req.body;

    // Validate input
    if (!name || !imageUrl) {
      return res
        .status(400)
        .json({ message: "Template name and image URL are required" });
    }

    // Normalize template name
    const normalizeTemplateName = (fileName = "") => {
      const rawBase = String(fileName)
        .replace(/\.[^/.]+$/, "")
        .trim();
      const sanitized = rawBase
        .replace(/[^a-zA-Z0-9\s-_]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      return sanitized || "template";
    };

    // Create template with Cloudinary URL and Public ID
    const template = await Template.create({
      name: `${normalizeTemplateName(name)}-${Date.now()}`,
      imageUrl: imageUrl,
      cloudinaryPublicId: cloudinaryPublicId || null,
      isDefault: false,
    });

    res.status(201).json({
      message: "Template saved successfully",
      id: template.id,
      name: template.name,
      imageUrl: template.imageUrl,
      cloudinaryPublicId: template.cloudinaryPublicId,
    });
  } catch (error) {
    console.error("Error in saveTemplateImage:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all templates
// @route   GET /api/admin/templates
// @access  Public
const getAllTemplates = async (req, res) => {
  try {
    const templates = await Template.findAll({
      order: [["createdAt", "DESC"]],
    });

    res.json(templates);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete template
// @route   DELETE /api/admin/templates/:id
// @access  Private (Admin)
const deleteTemplate = async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    await template.destroy();

    res.json({ message: "Template deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Change promotion status (admin can approve, reject, or deactivate)
// @route   PUT /api/admin/promotions/:promotionId/status
// @access  Private (Admin)
const changePromotionStatus = async (req, res) => {
  try {
    const { promotionId } = req.params;
    const { status } = req.body;

    if (!["inactive", "pending", "active"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be one of: active, inactive, pending",
      });
    }

    const promotion = await runWithDbRetry(
      () => Promotion.findByPk(promotionId),
      1,
    );

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (status === "active" && isPromotionPastStopDate(promotion.stopDate)) {
      return res.status(400).json({
        message:
          "Cannot activate an expired promotion. Extend the end date first, then activate it.",
      });
    }

    const oldStatus = promotion.status;
    promotion.status = status;

    // Set approvedAt timestamp when admin approves (marking inactive as approved)
    if (status === "inactive" && oldStatus === "pending") {
      promotion.approvedAt = new Date();
    }

    if (status === "active") {
      promotion.approvedAt = promotion.approvedAt || new Date();
    }

    await promotion.save({ fields: ["status", "approvedAt", "updatedAt"] });

    console.log(
      `🔄 [ADMIN] Promotion ${promotionId} status changed from ${oldStatus} to ${status}`,
    );

    res.json({
      message: `Promotion status updated from ${oldStatus} to ${status}`,
      promotion: normalizePromotionForFrontend(
        (await getPromotionWithRelations(promotion.id)) || promotion,
      ),
    });
  } catch (error) {
    console.error("Error changing promotion status:", error);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// Run a promotion: set only this promotion active without changing schedule or sibling promotions
const runPromotion = async (req, res) => {
  const { promotionId } = req.params;
  try {
    const promotion = await Promotion.findByPk(promotionId);
    if (!promotion)
      return res.status(404).json({ message: "Promotion not found" });

    if (isPromotionPastStopDate(promotion.stopDate)) {
      return res.status(400).json({
        message:
          "Cannot activate an expired promotion. Extend the end date first, then activate it.",
      });
    }

    promotion.status = "active";
    promotion.approvedAt = promotion.approvedAt || new Date();
    await runWithDbRetry(
      () => promotion.save({ fields: ["status", "approvedAt", "updatedAt"] }),
      1,
    );

    console.log(`✅ [ADMIN] Promotion ${promotionId} is now active`);
    const promotionWithRelations = await runWithDbRetry(
      () => getPromotionWithRelations(promotion.id),
      1,
    );
    res.json({
      message: "Promotion activated",
      promotion: normalizePromotionForFrontend(
        promotionWithRelations || promotion,
      ),
    });
  } catch (error) {
    console.error("Error running promotion:", error);
    if (isTransientDbTimeoutError(error)) {
      return res.status(503).json({
        success: false,
        message:
          "Database is temporarily slow. Please try running this promotion again in a few seconds.",
      });
    }
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// @desc    Get a single promotion (admin)
// @route   GET /api/admin/promotions/:id
// @access  Private (Admin)
const getPromotionById = async (req, res) => {
  try {
    const promotion = await getPromotionWithRelations(req.params.id);

    if (!promotion)
      return res.status(404).json({ message: "Promotion not found" });

    res.json({ promotion: normalizePromotionForFrontend(promotion) });
  } catch (error) {
    console.error("Error fetching promotion:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update promotion (admin)
// @route   PUT /api/admin/promotions/:id
// @access  Private (Admin)
const updatePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByPk(req.params.id);
    if (!promotion)
      return res.status(404).json({ message: "Promotion not found" });

    const hasField = (field) =>
      Object.prototype.hasOwnProperty.call(req.body, field);

    const {
      templateId,
      imageUrl,
      text,
      backgroundColor,
      cities,
      states,
      timezones,
      runDate,
      stopDate,
      runTime,
      metadata,
      stopTime,
      categories,
      scheduleEnabled,
      scheduleTimezone,
      scheduleStartAt,
      scheduleEndAt,
      businessId,
    } = req.body;
    const normalizedTemplateId = normalizeTemplateId(templateId);

    const targetBusinessId = hasField("businessId")
      ? businessId || null
      : promotion.businessId;
    const hasScheduleUpdate =
      hasField("businessId") ||
      hasField("runDate") ||
      hasField("stopDate") ||
      hasField("runTime") ||
      hasField("stopTime") ||
      hasField("scheduleEnabled") ||
      hasField("scheduleTimezone") ||
      hasField("scheduleStartAt") ||
      hasField("scheduleEndAt");

    let schedulePayload = null;
    let isScheduleEnabled = Boolean(promotion.scheduleEnabled);
    let responseScheduleTimezone = promotion.scheduleTimezone;

    if (hasScheduleUpdate && targetBusinessId) {
      const nextRunDate = runDate !== undefined ? runDate : promotion.runDate;
      const nextStopDate =
        stopDate !== undefined ? stopDate : promotion.stopDate;
      const nextRunTime = runTime !== undefined ? runTime : promotion.runTime;
      const nextStopTime =
        stopTime !== undefined ? stopTime : promotion.stopTime;

      if (!nextRunDate || !nextStopDate || !nextRunTime || !nextStopTime) {
        return res
          .status(400)
          .json({ message: "Missing schedule or time fields" });
      }

      const business = await Business.findByPk(targetBusinessId, {
        attributes: ["id", "timezone"],
      });
      if (!business) {
        return res.status(404).json({ message: "Business not found" });
      }

      const resolvedTimezone = resolveScheduleTimezone({
        scheduleTimezone:
          scheduleTimezone !== undefined
            ? scheduleTimezone
            : promotion.scheduleTimezone,
        ownerTimezone: business.timezone,
        actorTimezone: req.user?.timezone || getRequestTimezone(req),
      });

      schedulePayload = buildSchedulePayload({
        runDate: nextRunDate,
        stopDate: nextStopDate,
        runTime: nextRunTime,
        stopTime: nextStopTime,
        scheduleTimezone: resolvedTimezone,
        scheduleStartAt:
          scheduleStartAt !== undefined
            ? scheduleStartAt
            : promotion.scheduleStartAt,
        scheduleEndAt:
          scheduleEndAt !== undefined ? scheduleEndAt : promotion.scheduleEndAt,
      });

      if (!schedulePayload) {
        return res.status(400).json({
          message:
            "Invalid schedule values. Please provide valid runDate, stopDate, runTime, and stopTime.",
        });
      }

      isScheduleEnabled =
        scheduleEnabled !== undefined
          ? parseBoolean(scheduleEnabled, promotion.scheduleEnabled)
          : Boolean(promotion.scheduleEnabled);
      responseScheduleTimezone = schedulePayload.scheduleTimezone;

      if (isScheduleEnabled) {
        ensureValidScheduleWindow(schedulePayload);
        await ensureNoScheduledOverlap({
          businessId: targetBusinessId,
          scheduleStartAt: schedulePayload.scheduleStartAt,
          scheduleEndAt: schedulePayload.scheduleEndAt,
          excludePromotionId: promotion.id,
        });
      }
    } else if (hasScheduleUpdate) {
      const nextRunDate = runDate !== undefined ? runDate : promotion.runDate;
      const nextStopDate =
        stopDate !== undefined ? stopDate : promotion.stopDate;
      const nextRunTime = runTime !== undefined ? runTime : promotion.runTime;
      const nextStopTime =
        stopTime !== undefined ? stopTime : promotion.stopTime;

      if (!nextRunDate || !nextStopDate || !nextRunTime || !nextStopTime) {
        return res
          .status(400)
          .json({ message: "Missing schedule or time fields" });
      }

      schedulePayload = buildSchedulePayload({
        runDate: nextRunDate,
        stopDate: nextStopDate,
        runTime: nextRunTime,
        stopTime: nextStopTime,
        scheduleTimezone:
          scheduleTimezone !== undefined
            ? scheduleTimezone
            : promotion.scheduleTimezone || "UTC",
        scheduleStartAt:
          scheduleStartAt !== undefined
            ? scheduleStartAt
            : promotion.scheduleStartAt,
        scheduleEndAt:
          scheduleEndAt !== undefined ? scheduleEndAt : promotion.scheduleEndAt,
      });

      if (!schedulePayload) {
        return res.status(400).json({
          message:
            "Invalid schedule values. Please provide valid runDate, stopDate, runTime, and stopTime.",
        });
      }

      isScheduleEnabled =
        scheduleEnabled !== undefined
          ? parseBoolean(scheduleEnabled, promotion.scheduleEnabled)
          : false;
      responseScheduleTimezone = schedulePayload.scheduleTimezone;
    }

    if (templateId !== undefined) {
      promotion.templateId = normalizedTemplateId;
    }
    if (hasField("businessId")) {
      promotion.businessId = targetBusinessId;
    }
    if (hasField("imageUrl")) {
      promotion.imageUrl = imageUrl;
    }
    if (hasField("text")) {
      promotion.text = Array.isArray(text)
        ? text
        : text === null || text === ""
          ? []
          : [text];
    }
    if (hasField("backgroundColor")) {
      promotion.backgroundColor = backgroundColor;
    }
    if (hasField("cities")) {
      promotion.cities = Array.isArray(cities) ? cities : [];
    }
    if (hasField("states")) {
      promotion.states = Array.isArray(states) ? states : [];
    }
    if (hasField("timezones")) {
      promotion.timezones = Array.isArray(timezones) ? timezones : [];
    }
    if (schedulePayload) {
      promotion.runDate = schedulePayload.runDate;
      promotion.stopDate = schedulePayload.stopDate;
      promotion.runTime = schedulePayload.runTime;
      promotion.stopTime = schedulePayload.stopTime;
      promotion.scheduleEnabled = isScheduleEnabled;
      promotion.scheduleTimezone = schedulePayload.scheduleTimezone;
      promotion.scheduleStartAt = isScheduleEnabled
        ? schedulePayload.scheduleStartAt
        : null;
      promotion.scheduleEndAt = isScheduleEnabled
        ? schedulePayload.scheduleEndAt
        : null;
      promotion.calculatedMonths = calculateDurationMonths(
        schedulePayload.runDate,
        schedulePayload.stopDate,
      );
    }
    if (hasField("categories")) {
      promotion.categories = Array.isArray(categories) ? categories : [];
    }
    if (hasField("metadata") && metadata && typeof metadata === "object") {
      promotion.metadata = metadata;
    }
    await promotion.save();
    if (schedulePayload) {
      await reschedulePromotionJobs(promotion);
    }

    if (hasField("cities") || hasField("states") || hasField("timezones")) {
      try {
        await syncPromotionLocations({
          promotionId: promotion.id,
          cities: promotion.cities || [],
          states: promotion.states || [],
          timezones: promotion.timezones || [],
        });
      } catch (locationError) {
        console.warn(
          "PromotionLocations sync warning (admin update):",
          locationError.message,
        );
      }
    }

    const updatedPromotion = await getPromotionWithRelations(promotion.id);

    console.log(`✅ [ADMIN] Promotion ${promotion.id} updated by admin`);
    res.json({
      message: "Promotion updated",
      promotion: normalizePromotionForFrontend(updatedPromotion || promotion),
      scheduleTimezone: responseScheduleTimezone,
    });
  } catch (error) {
    console.error("Error updating promotion:", error);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// @desc    Create promotion directly by admin (no business selection required)
// @route   POST /api/admin/promotions
// @access  Private (Admin)
const createPromotionForBusiness = async (req, res) => {
  try {
    const {
      templateId,
      imageUrl,
      text,
      backgroundColor,
      cities = [],
      states = [],
      timezones = [],
      runDate,
      stopDate,
      runTime,
      metadata,
      categories = [],
      stopTime,
    } = req.body;
    const normalizedTemplateId = normalizeTemplateId(templateId);

    const now = new Date();
    const defaultRunDate = now.toISOString().slice(0, 10);
    const defaultStopDateObj = new Date(now);
    defaultStopDateObj.setUTCDate(defaultStopDateObj.getUTCDate() + 30);
    const defaultStopDate = defaultStopDateObj.toISOString().slice(0, 10);

    const parsedRunDate = parseDateOnly(runDate);
    const parsedStopDate = parseDateOnly(stopDate);
    const normalizedRunDate = (parsedRunDate || new Date(defaultRunDate))
      .toISOString()
      .slice(0, 10);
    const normalizedStopDate = (parsedStopDate || new Date(defaultStopDate))
      .toISOString()
      .slice(0, 10);
    const normalizedRunTime =
      typeof runTime === "string" && runTime.trim()
        ? runTime.trim()
        : "00:00:00";
    const normalizedStopTime =
      typeof stopTime === "string" && stopTime.trim()
        ? stopTime.trim()
        : "23:59:59";

    const promotion = await Promotion.create({
      businessId: null,
      templateId: normalizedTemplateId,
      imageUrl,
      text: Array.isArray(text) ? text : text ? [text] : [],
      backgroundColor: backgroundColor || "",
      categories: categories.length ? categories : [],
      cities,
      states,
      timezones,
      runDate: normalizedRunDate,
      metadata:
        metadata && typeof metadata === "object"
          ? { ...metadata, createdBy: "admin" }
          : { createdBy: "admin" },
      stopDate: normalizedStopDate,
      runTime: normalizedRunTime,
      stopTime: normalizedStopTime,
      scheduleEnabled: false,
      scheduleTimezone: "UTC",
      scheduleStartAt: null,
      scheduleEndAt: null,
      calculatedMonths: calculateDurationMonths(
        normalizedRunDate,
        normalizedStopDate,
      ),
      price: 0, // Admin does not pay
      status: "inactive", // Admin-created and approved but not active
      autoApprove: true,
      paymentStatus: "completed",
      approvedAt: new Date(),
    });
    try {
      await syncPromotionLocations({
        promotionId: promotion.id,
        cities,
        states,
        timezones,
      });
    } catch (locationError) {
      console.warn(
        "PromotionLocations sync warning (admin create):",
        locationError.message,
      );
    }

    const createdPromotion = await getPromotionWithRelations(promotion.id);
    res.status(201).json({
      promotion: normalizePromotionForFrontend(createdPromotion || promotion),
    });
  } catch (error) {
    console.error("ADMIN CREATE PROMOTION ERROR:", error);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
const toggleBusinessAutoApprove = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { autoApprovePromotions } = req.body;

    const business = await Business.findByPk(businessId);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    business.autoApprovePromotions = autoApprovePromotions;
    await business.save();

    console.log(
      `🔄 [ADMIN] Business ${businessId} auto-approve set to ${autoApprovePromotions}`,
    );

    res.json({
      message: `Business auto-approve ${
        autoApprovePromotions ? "enabled" : "disabled"
      }`,
      business,
    });
  } catch (error) {
    console.error("Error toggling business auto-approve:", error);
    res.status(500).json({ message: error.message });
  }
};
const approvePromotion = async (req, res) => {
  try {
    const { promotionId } = req.params;

    const promotion = await Promotion.findByPk(promotionId, {
      include: [{ model: Business, as: "business" }],
    });

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (promotion.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Only pending promotions can be approved" });
    }

    promotion.status = "inactive"; // Approved but NOT active
    promotion.approvedAt = new Date();
    await promotion.save();
    await reschedulePromotionJobs(promotion);

    console.log(`✅ [ADMIN] Promotion ${promotion.id} approved`);
    res.json({ message: "Promotion approved", promotion });
  } catch (error) {
    console.error("Error approving promotion:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ---------- MAKE USER ADMIN ---------- */
const makeAdmin = async (req, res) => {
  const { userId, roleId } = req.body;

  const user = await User.findByPk(userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  const role = await Role.findByPk(roleId);
  if (!role) return res.status(404).json({ message: "Role not found" });

  user.role = "admin";
  user.accountType = "admin";
  user.roleId = role.id;

  await user.save();

  res.json({ message: "User promoted to admin" });
};

/* ---------- UPDATE ADMIN ROLE ---------- */
const updateAdminRole = async (req, res) => {
  try {
    const { roleId, isSuperAdmin } = req.body;
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user || user.role !== "admin") {
      return res.status(404).json({ message: "Admin not found" });
    }

    if (isSuperAdmin) {
      user.isSuperAdmin = true;
      user.roleId = null;
    } else {
      user.isSuperAdmin = false;
      user.roleId = roleId;
    }

    await user.save();

    // Fetch role to include permissions in response
    let permissions = {};
    if (user.roleId) {
      const role = await Role.findByPk(user.roleId);
      if (role) {
        permissions = role.permissions || {};
      }
    }

    res.json({
      message: "Admin role updated",
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        roleId: user.roleId,
        permissions,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ---------- CREATE ADMIN USER ---------- */
const createAdminUser = async (req, res) => {
  try {
    const { fullName, email, password, roleId, isSuperAdmin } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    // Check if user exists
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Create admin user
    const user = await User.create({
      fullName,
      email,
      password,
      role: "admin",
      accountType: "admin",
      isSuperAdmin: isSuperAdmin || false,
      roleId: isSuperAdmin ? null : roleId,
      status: "active",
    });

    // Fetch role permissions if not super admin
    let permissions = {};
    if (!isSuperAdmin && roleId) {
      const role = await Role.findByPk(roleId);
      if (role) {
        permissions = role.permissions || {};
      }
    }

    res.status(201).json({
      message: "Admin user created successfully",
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        roleId: user.roleId,
        permissions: user?.roleId,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ---------- GET USER PERMISSIONS ---------- */
const getUserPermissions = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId, {
      include: { model: Role, attributes: ["id", "name", "permissions"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let permissions = {};
    if (user.isSuperAdmin) {
      // Super admin has all permissions
      permissions = {};
    } else if (user.roleId && user.Role) {
      permissions = user.Role.permissions || {};
    }

    res.json({
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.roleId,
      permissions,
      role: user.role,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getAllUsers,
  updateUserStatus,
  changePromotionStatus,
  updateAdminRole,
  makeAdmin,
  toggleBusinessAutoApprove,
  getAllBusinesses,
  exportBusinessesCsv,
  grantBusinessSubscription,
  approvePromotion,
  updateBusinessStatus,
  getAllPromotions,
  deletePromotion,
  getPromotionById,
  updatePromotion,
  createPromotionForBusiness,
  getAdminDashboard,
  saveTemplateImage,
  getAllTemplates,
  deleteTemplate,
  createAdminUser,
  getUserPermissions,
  runPromotion,
};
