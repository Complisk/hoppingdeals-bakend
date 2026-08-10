const { Op, fn, col } = require("sequelize");
const Business = require("../models/Business");
const Promotion = require("../models/Promotion");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// @desc    Public business directory — active businesses with active promotion counts
// @route   GET /api/business-directory
// @access  Public
const getBusinessDirectory = async (req, res) => {
  try {
    const businesses = await Business.findAll({
      where: { status: "active" },
      attributes: [
        "id",
        "name",
        "logoUrl",
        "businessType",
        "businessAddress",
        "categories",
      ],
      order: [["name", "ASC"]],
    });

    const promoCounts = await Promotion.findAll({
      attributes: ["businessId", [fn("COUNT", col("id")), "count"]],
      where: { status: "active", businessId: { [Op.ne]: null } },
      group: ["businessId"],
      raw: true,
    });

    const counts = {};
    for (const row of promoCounts) {
      counts[row.businessId] = Number(row.count) || 0;
    }

    return res.json({
      businesses: businesses.map((b) => ({
        id: b.id,
        name: b.name,
        logoUrl: b.logoUrl,
        businessType: b.businessType,
        businessAddress: b.businessAddress,
        categories: Array.isArray(b.categories) ? b.categories : [],
        activePromotions: counts[b.id] || 0,
      })),
    });
  } catch (error) {
    console.error("Business directory error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// @desc    Public single business profile with its active promotions
// @route   GET /api/business-directory/:id
// @access  Public
const getPublicBusinessProfile = async (req, res) => {
  try {
    if (!UUID_REGEX.test(String(req.params.id || ""))) {
      return res.status(404).json({ message: "Business not found" });
    }

    const business = await Business.findOne({
      where: { id: req.params.id, status: "active" },
      attributes: { exclude: ["password", "email"] },
    });

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const promotions = await Promotion.findAll({
      where: { businessId: business.id, status: "active" },
      order: [["createdAt", "DESC"]],
    });

    return res.json({ business, promotions });
  } catch (error) {
    console.error("Public business profile error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

module.exports = {
  getBusinessDirectory,
  getPublicBusinessProfile,
};
