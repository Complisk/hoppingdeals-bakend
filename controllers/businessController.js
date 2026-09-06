const Promotion = require("../models/Promotion");
const Business = require("../models/Business");
const PromotionLocation = require("../models/PromotionLocation");
const BusinessPromotionTemplate = require("../models/BusinessPromotionTemplate");
const stripe = require("../config/stripe");
const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const {
  getValidActiveSubscription,
} = require("../utils/businessSubscriptionUtils");
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
const { isTrustedPromotionImageUrl } = require("./promotionImageController");

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

const getBusinessPromotionWithRelations = async (promotionId, businessId) => {
  const locationAttributes = await getPromotionLocationAttributes();

  return Promotion.findOne({
    where: { id: promotionId, businessId },
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

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeTemplateId = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return UUID_REGEX.test(normalized) ? normalized : null;
};

const EXTRA_STATE_PRICE = 500;

const buildApiErrorPayload = (error, fallbackMessage = "Server error") => ({
  message: error?.message || fallbackMessage,
  ...(error?.code ? { code: error.code } : {}),
  ...(error?.conflictPromotionId
    ? { conflictPromotionId: error.conflictPromotionId }
    : {}),
});

const getRequestTimezone = (req) =>
  String(
    req?.headers?.["x-timezone"] || req?.headers?.["x-user-timezone"] || "",
  ).trim();

const normalizeStateCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const normalizeStateName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getStateIdentity = (state) => ({
  code: normalizeStateCode(state?.state_code || state?.code),
  name: normalizeStateName(state?.state_name || state?.name || state?.state),
});

const validateBusinessStateEdit = ({
  existingStates = [],
  nextStates = [],
}) => {
  const safeExisting = Array.isArray(existingStates) ? existingStates : [];
  const safeNext = Array.isArray(nextStates) ? nextStates : [];

  const allowedCodes = new Set();
  const allowedNames = new Set();
  const allowedLabels = [];

  safeExisting.forEach((state) => {
    const identity = getStateIdentity(state);
    if (identity.code) allowedCodes.add(identity.code);
    if (identity.name) allowedNames.add(identity.name);

    const displayName =
      String(state?.state_name || state?.name || "").trim() || null;
    const displayCode =
      String(state?.state_code || state?.code || "")
        .trim()
        .toUpperCase() || null;
    if (displayName && displayCode) {
      allowedLabels.push(`${displayName} (${displayCode})`);
    } else if (displayName) {
      allowedLabels.push(displayName);
    } else if (displayCode) {
      allowedLabels.push(displayCode);
    }
  });

  const hasAnyExistingStates = allowedCodes.size > 0 || allowedNames.size > 0;
  if (!hasAnyExistingStates) {
    if (safeNext.length > 0) {
      return {
        ok: false,
        message:
          "This promotion has no existing states. Adding new states in edit is not allowed.",
      };
    }
    return { ok: true };
  }

  for (const state of safeNext) {
    const identity = getStateIdentity(state);
    const hasIdentity = Boolean(identity.code || identity.name);
    if (!hasIdentity) {
      return {
        ok: false,
        message:
          "Invalid state payload. Each state must include state_code or state_name.",
      };
    }

    const codeAllowed = identity.code && allowedCodes.has(identity.code);
    const nameAllowed = identity.name && allowedNames.has(identity.name);
    if (!codeAllowed && !nameAllowed) {
      const allowedList = allowedLabels.length
        ? allowedLabels.join(", ")
        : "existing promotion states";
      return {
        ok: false,
        message: `Only existing states can be used in edit mode. Allowed: ${allowedList}.`,
      };
    }
  }

  return { ok: true };
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

// @desc    Create new promotion
// @route   POST /api/business/promotions
// @access  Private (Business)
const createPromotion = async (req, res) => {
  try {
    const business = await Business.findByPk(req.business.id);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const subscription =
      req.activeSubscription ||
      (await getValidActiveSubscription(req.business.id));

    if (!subscription) {
      return res.status(403).json({
        message: "Active subscription required to create promotions",
        code: "ACTIVE_SUBSCRIPTION_REQUIRED",
      });
    }

    const {
      templateId,
      businessTemplateId,
      imageUrl,
      text,
      backgroundColor,
      cities = [],
      states = [],
      timezones = [],
      runDate,
      stopDate,
      runTime,
      stopTime,
      scheduleEnabled,
      scheduleTimezone,
      metadata = {},
      categories = [],
    } = req.body;

    const normalizedTemplateId = normalizeTemplateId(templateId);
    const normalizedBusinessTemplateId =
      normalizeTemplateId(businessTemplateId);
    const businessTemplate = normalizedBusinessTemplateId
      ? await BusinessPromotionTemplate.findOne({
          where: {
            id: normalizedBusinessTemplateId,
            businessId: req.business.id,
          },
        })
      : null;

    if (normalizedBusinessTemplateId && !businessTemplate) {
      return res.status(404).json({ message: "Promotion template not found" });
    }

    if (normalizedBusinessTemplateId && !subscription) {
      return res.status(403).json({
        message:
          "Active subscription is required before using a promotion template",
        code: "TEMPLATE_SUBSCRIPTION_REQUIRED",
      });
    }

    const normalizedMetadata =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : {};
    const resolvedImageUrl = String(
      imageUrl || businessTemplate?.imageUrl || "",
    ).trim();
    const resolvedText =
      text !== undefined
        ? Array.isArray(text)
          ? text
          : text
            ? [text]
            : []
        : Array.isArray(businessTemplate?.text)
          ? businessTemplate.text
          : [];
    const resolvedBackgroundColor =
      backgroundColor !== undefined && backgroundColor !== null
        ? String(backgroundColor)
        : businessTemplate?.backgroundColor || "";
    const resolvedMetadata = {
      ...(businessTemplate?.metadata &&
      typeof businessTemplate.metadata === "object" &&
      !Array.isArray(businessTemplate.metadata)
        ? businessTemplate.metadata
        : {}),
      ...normalizedMetadata,
      ...(normalizedBusinessTemplateId
        ? { sourceBusinessTemplateId: normalizedBusinessTemplateId }
        : {}),
    };

    if (!resolvedImageUrl || !runDate || !stopDate || !runTime || !stopTime) {
      return res.status(400).json({
        message:
          "Missing required fields: imageUrl, runDate, stopDate, runTime, stopTime",
      });
    }
    if (!isTrustedPromotionImageUrl(resolvedImageUrl) && !resolvedImageUrl.startsWith("data:image/svg+xml")) {
      return res.status(400).json({ message: "Please use an approved promotion image" });
    }

    const resolvedScheduleTimezone = resolveScheduleTimezone({
      scheduleTimezone,
      ownerTimezone: business.timezone,
      actorTimezone: req.business?.timezone || getRequestTimezone(req),
    });

    const schedulePayload = buildSchedulePayload({
      runDate,
      stopDate,
      runTime,
      stopTime,
      scheduleTimezone: resolvedScheduleTimezone,
    });

    if (!schedulePayload) {
      return res.status(400).json({
        message:
          "Invalid schedule values. Please provide valid runDate, stopDate, runTime, and stopTime.",
      });
    }

    const isScheduleEnabled = subscription
      ? parseBoolean(scheduleEnabled, false)
      : false;
    if (isScheduleEnabled) {
      ensureValidScheduleWindow(schedulePayload);
      await ensureNoScheduledOverlap({
        businessId: business.id,
        scheduleStartAt: schedulePayload.scheduleStartAt,
        scheduleEndAt: schedulePayload.scheduleEndAt,
      });
    }

    const safeStates = normalizeArray(states);
    const safeCities = normalizeArray(cities);
    const safeTimezones = normalizeArray(timezones);

    const maxCitiesAllowed = Math.max(0, Number(subscription.freeCities || 0));

    if (safeCities.length > maxCitiesAllowed) {
      return res.status(400).json({
        message: `Maximum ${maxCitiesAllowed} ${maxCitiesAllowed === 1 ? "city" : "cities"} allowed for your current plan`,
      });
    }

    const freeStates = Number(subscription.freeStates || 0);
    const extraStates = Math.max(0, safeStates.length - freeStates);
    const stateCost = extraStates > 0 ? extraStates * EXTRA_STATE_PRICE : 0;
    const totalPrice = stateCost;

    const promotion = await Promotion.create({
      businessId: business.id,
      templateId: normalizedTemplateId,
      imageUrl: resolvedImageUrl,
      text: resolvedText,
      backgroundColor: resolvedBackgroundColor,
      categories:
        Array.isArray(categories) && categories.length
          ? categories
          : normalizeArray(business.categories),
      cities: safeCities,
      states: safeStates,
      timezones: safeTimezones,
      runDate: schedulePayload.runDate,
      stopDate: schedulePayload.stopDate,
      runTime: schedulePayload.runTime,
      stopTime: schedulePayload.stopTime,
      scheduleEnabled: isScheduleEnabled,
      scheduleTimezone: schedulePayload.scheduleTimezone,
      scheduleStartAt: schedulePayload.scheduleStartAt,
      scheduleEndAt: schedulePayload.scheduleEndAt,
      calculatedMonths: calculateDurationMonths(
        schedulePayload.runDate,
        schedulePayload.stopDate,
      ),
      price: totalPrice,
      status:
        totalPrice > 0
          ? "pending"
          : business.autoApprovePromotions
            ? "inactive"
            : "pending",
      autoApprove: Boolean(business.autoApprovePromotions),
      paymentStatus: totalPrice > 0 ? "pending" : "completed",
      metadata: resolvedMetadata,
    });

    await reschedulePromotionJobs(promotion);

    try {
      await syncPromotionLocations({
        promotionId: promotion.id,
        cities: safeCities,
        states: safeStates,
        timezones: safeTimezones,
      });
    } catch (locationError) {
      console.warn(
        "PromotionLocations sync warning (business create):",
        locationError.message,
      );
    }

    const createdPromotion = await getBusinessPromotionWithRelations(
      promotion.id,
      business.id,
    );

    const normalizedPromotion = normalizePromotionForFrontend(
      createdPromotion || promotion,
    );

    if (totalPrice > 0) {
      if (!business.stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: business.email,
          name: business.name,
          metadata: { businessId: business.id },
        });
        business.stripeCustomerId = customer.id;
        await business.save();
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalPrice * 100),
        currency: "usd",
        customer: business.stripeCustomerId,
        payment_method_types: ["card"],
        metadata: {
          promotionId: promotion.id,
          businessId: business.id,
        },
        description: `Promotion add-ons: ${extraStates} extra states`,
      });

      return res.status(201).json({
        message: "Promotion created. Payment is required to proceed.",
        promotion: normalizedPromotion,
        scheduleTimezone: schedulePayload.scheduleTimezone,
        pricing: {
          freeStates,
          extraStates,
          stateUnitPrice: EXTRA_STATE_PRICE,
          stateCost,
          total: totalPrice,
        },
        clientSecret: paymentIntent.client_secret,
        requiresPayment: true,
      });
    }

    return res.status(201).json({
      message: "Promotion created successfully",
      promotion: normalizedPromotion,
      scheduleTimezone: schedulePayload.scheduleTimezone,
      pricing: {
        freeStates,
        extraStates,
        stateUnitPrice: EXTRA_STATE_PRICE,
        stateCost,
        total: totalPrice,
      },
      clientSecret: null,
      requiresPayment: false,
    });
  } catch (error) {
    console.error("CREATE PROMOTION ERROR:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json(buildApiErrorPayload(error));
  }
};

// @desc    Get all business promotions
// @route   GET /api/business/promotions
// @access  Private (Business)
const getBusinessPromotions = async (req, res) => {
  try {
    const { search = "", status = "", page = 1, limit = 50 } = req.query;

    const parsedPage =
      Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const parsedLimit =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 50;
    const offset = (parsedPage - 1) * parsedLimit;

    const whereClause = {
      businessId: req.business.id,
    };

    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const validStatuses = ["active", "inactive", "pending", "expired"];
    if (normalizedStatus && validStatuses.includes(normalizedStatus)) {
      whereClause.status = normalizedStatus;
    }

    const normalizedSearch = String(search || "")
      .trim()
      .toLowerCase();
    if (normalizedSearch) {
      whereClause.categories = { [Op.overlap]: [normalizedSearch] };
    }

    const locationAttributes = await getPromotionLocationAttributes();

    const { count, rows } = await Promotion.findAndCountAll({
      where: whereClause,
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
          required: false,
        },
        {
          model: PromotionLocation,
          as: "locations",
          attributes: locationAttributes,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parsedLimit,
      offset,
      distinct: true,
    });

    const promotions = rows;

    res.json({
      promotions,
      pagination: {
        total: count,
        pages: Math.ceil(count / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get one business promotion
// @route   GET /api/business/promotions/:promotionId
// @access  Private (Business)
const getPromotionById = async (req, res) => {
  try {
    const { promotionId } = req.params;

    const promotion = await getBusinessPromotionWithRelations(
      promotionId,
      req.business.id,
    );

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    res.json({ promotion: normalizePromotionForFrontend(promotion) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update promotion
// @route   PUT /api/business/promotions/:id
// @access  Private (Business)
const updatePromotion = async (req, res) => {
  try {
    const activeSubscription = await getValidActiveSubscription(
      req.business.id,
    );

    const promotion = await Promotion.findOne({
      where: {
        id: req.params.id,
        businessId: req.business.id,
      },
    });

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    const {
      templateId,
      imageUrl,
      text,
      backgroundColor,
      runDate,
      stopDate,
      runTime,
      stopTime,
      states,
      cities,
      timezones,
      categories,
      metadata,
      scheduleEnabled,
      scheduleTimezone,
    } = req.body;

    const nextRunDate = runDate !== undefined ? runDate : promotion.runDate;
    const nextStopDate = stopDate !== undefined ? stopDate : promotion.stopDate;
    const nextRunTime = runTime !== undefined ? runTime : promotion.runTime;
    const nextStopTime = stopTime !== undefined ? stopTime : promotion.stopTime;
    const businessForTimezone = await Business.findByPk(req.business.id, {
      attributes: ["timezone"],
    });
    const resolvedScheduleTimezone = resolveScheduleTimezone({
      scheduleTimezone:
        scheduleTimezone !== undefined
          ? scheduleTimezone
          : promotion.scheduleTimezone,
      ownerTimezone: businessForTimezone?.timezone,
      actorTimezone: req.business?.timezone || getRequestTimezone(req),
    });

    const schedulePayload = buildSchedulePayload({
      runDate: nextRunDate,
      stopDate: nextStopDate,
      runTime: nextRunTime,
      stopTime: nextStopTime,
      scheduleTimezone: resolvedScheduleTimezone,
    });

    if (!schedulePayload) {
      return res.status(400).json({
        message:
          "Invalid schedule values. Please provide valid runDate, stopDate, runTime, and stopTime.",
      });
    }

    const requestedScheduleEnabled =
      scheduleEnabled !== undefined
        ? parseBoolean(scheduleEnabled, promotion.scheduleEnabled)
        : Boolean(promotion.scheduleEnabled);
    const isScheduleEnabled = activeSubscription
      ? requestedScheduleEnabled
      : false;

    if (isScheduleEnabled) {
      ensureValidScheduleWindow(schedulePayload);
      await ensureNoScheduledOverlap({
        businessId: req.business.id,
        scheduleStartAt: schedulePayload.scheduleStartAt,
        scheduleEndAt: schedulePayload.scheduleEndAt,
        excludePromotionId: promotion.id,
      });
    }

    if (templateId !== undefined) {
      promotion.templateId = normalizeTemplateId(templateId);
    }
    if (imageUrl !== undefined) {
      if (
        String(imageUrl) !== String(promotion.imageUrl) &&
        !isTrustedPromotionImageUrl(imageUrl) &&
        !String(imageUrl).startsWith("data:image/svg+xml")
      ) {
        return res.status(400).json({ message: "Please use an approved promotion image" });
      }
      promotion.imageUrl = imageUrl;
    }
    if (text !== undefined) {
      promotion.text = Array.isArray(text) ? text : text ? [text] : [];
    }
    if (backgroundColor !== undefined)
      promotion.backgroundColor = backgroundColor;
    promotion.runDate = schedulePayload.runDate;
    promotion.stopDate = schedulePayload.stopDate;
    promotion.runTime = schedulePayload.runTime;
    promotion.stopTime = schedulePayload.stopTime;
    promotion.scheduleEnabled = isScheduleEnabled;
    promotion.scheduleTimezone = schedulePayload.scheduleTimezone;
    promotion.scheduleStartAt = schedulePayload.scheduleStartAt;
    promotion.scheduleEndAt = schedulePayload.scheduleEndAt;
    if (Array.isArray(states)) promotion.states = states;
    if (Array.isArray(cities)) promotion.cities = cities;
    if (Array.isArray(timezones)) promotion.timezones = timezones;
    if (Array.isArray(categories)) promotion.categories = categories;
    if (metadata && typeof metadata === "object") promotion.metadata = metadata;

    if (promotion.runDate && promotion.stopDate) {
      promotion.calculatedMonths = calculateDurationMonths(
        promotion.runDate,
        promotion.stopDate,
      );
    }

    await promotion.save();
    await reschedulePromotionJobs(promotion);

    if (
      Array.isArray(states) ||
      Array.isArray(cities) ||
      Array.isArray(timezones)
    ) {
      try {
        await syncPromotionLocations({
          promotionId: promotion.id,
          cities: promotion.cities || [],
          states: promotion.states || [],
          timezones: promotion.timezones || [],
        });
      } catch (locationError) {
        console.warn(
          "PromotionLocations sync warning (business update):",
          locationError.message,
        );
      }
    }

    const updatedPromotion = await getBusinessPromotionWithRelations(
      promotion.id,
      req.business.id,
    );

    res.json({
      message: "Promotion updated successfully",
      promotion: normalizePromotionForFrontend(updatedPromotion || promotion),
      scheduleTimezone: schedulePayload.scheduleTimezone,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json(buildApiErrorPayload(error));
  }
};

// @desc    Delete promotion
// @route   DELETE /api/business/promotions/:id
// @access  Private (Business)
const deletePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findOne({
      where: {
        id: req.params.id,
        businessId: req.business.id,
      },
    });

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    await cancelPromotionJobs(promotion);
    await promotion.destroy();

    res.json({ message: "Promotion deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const clamp = (value, max) => Math.min(value, max);

// @desc    Get business dashboard statistics
// @route   GET /api/business/dashboard
// @access  Private (Business)
const getDashboard = async (req, res) => {
  try {
    const businessId = req.business.id;
    const now = new Date();

    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    const last30Days = new Date();
    last30Days.setDate(now.getDate() - 30);

    const weeklyCount = await Promotion.count({
      where: { businessId, createdAt: { [Op.gte]: last7Days } },
    });

    const monthlyCount = await Promotion.count({
      where: { businessId, createdAt: { [Op.gte]: last30Days } },
    });

    const totalPromotions = await Promotion.count({ where: { businessId } });
    const activePromotions = await Promotion.count({
      where: { businessId, status: "active" },
    });

    let taggingStats = { totalTaggings: 0, userTaggers: 0, businessTaggers: 0 };
    const placeId = req.business.placeId ? String(req.business.placeId) : "";
    if (placeId) {
      const [row] = await sequelize.query(
        `
SELECT
  COUNT(*)::int AS "totalTaggings",
  COUNT(DISTINCT "taggerUserId")::int AS "userTaggers",
  COUNT(DISTINCT "taggerBusinessId")::int AS "businessTaggers"
FROM "BusinessTaggings"
WHERE "targetPlaceId" = :placeId;
`,
        {
          replacements: { placeId },
          type: sequelize.Sequelize.QueryTypes.SELECT,
        },
      );

      taggingStats = {
        totalTaggings: row?.totalTaggings || 0,
        userTaggers: row?.userTaggers || 0,
        businessTaggers: row?.businessTaggers || 0,
      };
    }

    let momentumScore = clamp(Math.floor((totalPromotions / 25) * 100), 100);
    let momentumLevel = "Low";
    if (momentumScore >= 70) momentumLevel = "High";
    else if (momentumScore >= 40) momentumLevel = "Medium";

    res.json({
      response: {
        stats: {
          totalPromotions,
          activePromotions,
          taggedByUsers: taggingStats.userTaggers,
        },
        chartData: {
          weekly: weeklyCount,
          monthly: monthlyCount,
          momentum: {
            score: momentumScore,
            level: momentumLevel,
            message:
              momentumLevel === "High"
                ? "Excellent promotion consistency"
                : momentumLevel === "Medium"
                  ? "Keep up the momentum!"
                  : "Run promotions more frequently to improve momentum",
          },
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Activate promotion
// @route   POST /api/business/promotions/:promotionId/activate
// @access  Private (Business)
const activatePromotion = async (req, res) => {
  try {
    const { promotionId } = req.params;

    const subscription = await getValidActiveSubscription(req.business.id);
    if (!subscription) {
      return res.status(403).json({
        message: "Active subscription required to activate promotions",
      });
    }

    const promotion = await Promotion.findOne({
      where: { id: promotionId, businessId: req.business.id },
    });

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (promotion.status === "pending") {
      return res.status(400).json({
        message:
          "Promotion is not approved yet. Please wait for admin approval or 24 hours.",
      });
    }

    if (promotion.scheduleEnabled) {
      const now = new Date();
      const startAt = promotion.scheduleStartAt
        ? new Date(promotion.scheduleStartAt)
        : null;
      const endAt = promotion.scheduleEndAt
        ? new Date(promotion.scheduleEndAt)
        : null;

      if (endAt && now >= endAt) {
        promotion.status = "expired";
        await promotion.save({ fields: ["status", "updatedAt"] });
        await reschedulePromotionJobs(promotion);
        return res.status(400).json({
          message:
            "This promotion has already reached its scheduled end time and is expired.",
        });
      }

      if (startAt && now < startAt) {
        return res.status(400).json({
          message:
            "This promotion has scheduling enabled and will activate automatically at its scheduled start time.",
        });
      }
    }

    await Promotion.update(
      { status: "inactive" },
      {
        where: {
          businessId: req.business.id,
          status: "active",
          id: { [Op.ne]: promotion.id },
        },
      },
    );

    promotion.status = "active";
    if (!promotion.approvedAt) {
      promotion.approvedAt = new Date();
    }
    await promotion.save();
    await reschedulePromotionJobs(promotion);

    const updated = await getBusinessPromotionWithRelations(
      promotion.id,
      req.business.id,
    );

    res.json({
      message: "Promotion activated successfully",
      promotion: normalizePromotionForFrontend(updated || promotion),
    });
  } catch (error) {
    console.error("Error activating promotion:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Deactivate promotion
// @route   POST /api/business/promotions/:promotionId/deactivate
// @access  Private (Business)
const deactivatePromotion = async (req, res) => {
  try {
    const { promotionId } = req.params;

    const promotion = await Promotion.findOne({
      where: { id: promotionId, businessId: req.business.id },
    });

    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (promotion.status === "pending") {
      return res.status(400).json({
        message: "Pending promotion cannot be deactivated. Approve it first.",
      });
    }

    if (promotion.status === "expired") {
      return res.status(400).json({
        message: "Expired promotion cannot be deactivated.",
      });
    }

    promotion.status = "inactive";
    await promotion.save();

    const updated = await getBusinessPromotionWithRelations(
      promotion.id,
      req.business.id,
    );

    return res.json({
      message: "Promotion successfully deactivated",
      promotion: normalizePromotionForFrontend(updated || promotion),
    });
  } catch (error) {
    console.error("Error deactivating promotion:", error);
    res.status(500).json({ message: "Server error: " + error.message });
  }
};

module.exports = {
  createPromotion,
  activatePromotion,
  deactivatePromotion,
  getBusinessPromotions,
  updatePromotion,
  deletePromotion,
  getPromotionById,
  getDashboard,
};
