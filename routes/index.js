// Main routes index file
// This file centralizes all route configurations and model relationships

const locationRoutes = require("./locationRoutes");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const businessRoutes = require("./businessRoutes");
const adminRoutes = require("./adminRoutes");
const promotionRoutes = require("./promotionRoutes");
const paymentRoutes = require("./paymentRoutes");
const subscriptionRoutes = require("./subscriptionRoutes");
const subscriptionsTemplateRoutes = require("./subscriptionsTemplateRoutes");
const roleRoutes = require("./roleRoutes");
const wishlistRoutes = require("./wishlistRoutes");
const supportRoutes = require("./supportRoutes");
const businessTaggingRoutes = require("./businessTaggingRoutes");
const photoRoutes = require("./photoRoutes");
const businessDirectoryRoutes = require("./businessDirectoryRoutes");

// Import models
const Business = require("../models/Business");
const Promotion = require("../models/Promotion");
const Template = require("../models/Template");
const Photo = require("../models/Photo");
const User = require("../models/User");
const Role = require("../models/Role");
const Wishlist = require("../models/Wishlist");
const BusinessTagging = require("../models/BusinessTagging");
const { default: axios } = require("axios");
const SubscriptionHistory = require("../models/SubscriptionHistory");
const BusinessSubscription = require("../models/BusinessSubscription");
const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const PromotionLocation = require("../models/PromotionLocation");
const BusinessPromotionTemplate = require("../models/BusinessPromotionTemplate");
/**
 * Setup all model relationships
 */
const setupModelRelationships = () => {
  // A Business has many Promotions
  Business.hasMany(Promotion, {
    foreignKey: "businessId",
    as: "promotions",
  });

  // A Promotion belongs to a Business
  Promotion.belongsTo(Business, {
    foreignKey: "businessId",
    as: "business",
  });

  Business.hasMany(BusinessPromotionTemplate, {
    foreignKey: "businessId",
    as: "promotionTemplates",
    onDelete: "CASCADE",
  });
  BusinessPromotionTemplate.belongsTo(Business, {
    foreignKey: "businessId",
    as: "business",
  });

  Template.hasMany(Promotion, { foreignKey: "templateId", as: "promotions" });
  Promotion.belongsTo(Template, { foreignKey: "templateId", as: "template" });

  Template.hasMany(BusinessPromotionTemplate, {
    foreignKey: "templateId",
    as: "businessPromotionTemplates",
  });
  BusinessPromotionTemplate.belongsTo(Template, {
    foreignKey: "templateId",
    as: "template",
  });

  Role.hasMany(User, {
    foreignKey: "roleId",
    as: "users",
  });

  User.belongsTo(Role, {
    foreignKey: "roleId",
    as: "role",
  });
  Business.hasMany(BusinessSubscription, {
    foreignKey: "businessId",
    as: "subscriptions",
    onDelete: "CASCADE",
  });

  BusinessSubscription.belongsTo(Business, {
    foreignKey: "businessId",
    as: "business",
  });

  // 🔹 One Template → Many Business Subscriptions
  SubscriptionTemplate.hasMany(BusinessSubscription, {
    foreignKey: "subscriptionTemplateId",
    as: "businessSubscriptions",
  });

  BusinessSubscription.belongsTo(SubscriptionTemplate, {
    foreignKey: "subscriptionTemplateId",
    as: "template",
  });

  // 🔹 Wishlist Relationships
  // A Wishlist entry belongs to a User (optional)
  Wishlist.belongsTo(User, {
    foreignKey: "userId",
    as: "user",
  });

  // A User has many Wishlist entries
  User.hasMany(Wishlist, {
    foreignKey: "userId",
    as: "wishlistItems",
  });
  Promotion.hasMany(PromotionLocation, {
    foreignKey: "promotionId",
    as: "locations",
  });
  PromotionLocation.belongsTo(Promotion, {
    foreignKey: "promotionId",
  });

  // A Wishlist entry belongs to a Business (optional)
  Wishlist.belongsTo(Business, {
    foreignKey: "businessId",
    as: "savedByBusiness",
  });

  // A Business has many Wishlist entries
  Business.hasMany(Wishlist, {
    foreignKey: "businessId",
    as: "savedPromotions",
  });

  // A Wishlist entry belongs to a Promotion
  Wishlist.belongsTo(Promotion, {
    foreignKey: "promotionId",
    as: "Promotion",
  });

  // A Promotion has many Wishlist entries
  Promotion.hasMany(Wishlist, {
    foreignKey: "promotionId",
    as: "wishlists",
  });

  // Business Tagging Relationships (user/business -> Google Place business)
  BusinessTagging.belongsTo(User, {
    foreignKey: "taggerUserId",
    as: "taggerUser",
  });

  BusinessTagging.belongsTo(Business, {
    foreignKey: "taggerBusinessId",
    as: "taggerBusiness",
  });

  User.hasMany(BusinessTagging, {
    foreignKey: "taggerUserId",
    as: "businessTaggings",
  });

  Business.hasMany(BusinessTagging, {
    foreignKey: "taggerBusinessId",
    as: "businessTaggings",
  });
};

/**
 * Setup all route handlers
 * @param {Express.App} app - Express application instance
 */
const setupRoutes = (app) => {
  // Health check route
  app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "Server is running" });
  });

  // API Routes
  app.use("/api/location", locationRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/business", businessRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/roles", roleRoutes);
  app.use("/api/promotions", promotionRoutes);
  app.use("/api/payment", paymentRoutes);
  app.use("/api/subscription", subscriptionRoutes);
  app.use("/api/subscription-template", subscriptionsTemplateRoutes);
  app.use("/api/wishlist", wishlistRoutes);
  app.use("/api/support", supportRoutes);
  app.use("/api/business-tagging", businessTaggingRoutes);
  app.use("/api/photos", photoRoutes);
  app.use("/api/business-directory", businessDirectoryRoutes);
  app.get("/api/locationtest", async (req, res) => {
    try {
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress;

      const response = await axios.get(
        `https://ipinfo.io/${ip}?token=YOUR_TOKEN`,
      );

      const data = response.data;

      res.json({
        ip: data.ip,
        city: data.city,
        state: data.region,
        country: data.country,
        timezone: data.timezone,
        loc: data.loc, // "lat,long"
      });
    } catch (err) {
      res.status(500).json({ error: "Location fetch failed" });
    }
  });
};

module.exports = {
  setupRoutes,
  setupModelRelationships,
  locationRoutes,
  authRoutes,
  userRoutes,
  businessRoutes,
  adminRoutes,
  promotionRoutes,
  paymentRoutes,
  roleRoutes,
  wishlistRoutes,
  supportRoutes,
  businessTaggingRoutes,
  photoRoutes,
  businessDirectoryRoutes,
};
