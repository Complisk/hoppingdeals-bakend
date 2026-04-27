const BusinessTagging = require("../models/BusinessTagging");
const User = require("../models/User");
const Business = require("../models/Business");
const { sequelize } = require("../config/db");

const resolveTagger = (req) => {
  if (req.authType === "business" && req.business?.id) {
    return {
      taggerType: "business",
      ownerField: "taggerBusinessId",
      ownerId: req.business.id,
      taggerBusinessId: req.business.id,
      taggerUserId: null,
    };
  }

  if (req.authType === "user" && req.user?.id) {
    return {
      taggerType: "user",
      ownerField: "taggerUserId",
      ownerId: req.user.id,
      taggerUserId: req.user.id,
      taggerBusinessId: null,
    };
  }

  return null;
};

// @desc    Create a business tag (user or business tags a Google Place business)
// @route   POST /api/business-tagging
// @access  Private (User or Business)
const createBusinessTagging = async (req, res) => {
  try {
    const {
      placeId,
      name,
      address,
      iconMaskBaseUri,
      iconBackgroundColor,
      primaryPhotoUrl,
      rating,
      userRatingsTotal,
      website,
      url, // Google Places "url"
      googleUrl, // alias
      formattedPhoneNumber,
      internationalPhoneNumber,
      types,
      reviews,
      email,
    } = req.body || {};

    const tagger = resolveTagger(req);
    if (!tagger) {
      return res.status(403).json({
        success: false,
        message: "Only user or business accounts can tag businesses",
      });
    }

    if (!placeId || !name) {
      return res.status(400).json({
        success: false,
        message: "placeId and name are required",
      });
    }

    const truncateString = (value, max) => {
      if (value === null || value === undefined) return null;
      const str = String(value);
      return str.length > max ? str.slice(0, max) : str;
    };

    const normalizedPlaceId = String(placeId).trim();
    const normalizedName = String(name).trim();
    const normalizedAddress = address ? String(address).trim() : null;

    const normalizedIconMaskBaseUri =
      iconMaskBaseUri ? truncateString(iconMaskBaseUri, 2048) : null;
    const normalizedIconBackgroundColor = iconBackgroundColor
      ? truncateString(iconBackgroundColor, 32)
      : null;
    const normalizedPrimaryPhotoUrl = primaryPhotoUrl
      ? truncateString(primaryPhotoUrl, 2048)
      : null;

    const normalizedRating =
      rating === null || rating === undefined || rating === ""
        ? null
        : Number(rating);
    const normalizedUserRatingsTotal =
      userRatingsTotal === null ||
      userRatingsTotal === undefined ||
      userRatingsTotal === ""
        ? null
        : Number(userRatingsTotal);

    const normalizedWebsite = website ? truncateString(website, 2048) : null;
    const normalizedGoogleUrl = (url || googleUrl)
      ? truncateString(url || googleUrl, 2048)
      : null;

    const normalizedFormattedPhoneNumber = formattedPhoneNumber
      ? truncateString(formattedPhoneNumber, 64)
      : null;
    const normalizedInternationalPhoneNumber = internationalPhoneNumber
      ? truncateString(internationalPhoneNumber, 64)
      : null;

    const normalizedTypes = Array.isArray(types)
      ? types
          .filter((t) => typeof t === "string" && t.trim())
          .slice(0, 50)
      : null;

    const normalizedReviews = Array.isArray(reviews)
      ? reviews
          .slice(0, 5)
          .map((r) => ({
            author_name: truncateString(r?.author_name, 255),
            author_url: truncateString(r?.author_url, 2048),
            profile_photo_url: truncateString(r?.profile_photo_url, 2048),
            language: truncateString(r?.language, 32),
            rating:
              r?.rating === null || r?.rating === undefined ? null : Number(r.rating),
            relative_time_description: truncateString(
              r?.relative_time_description,
              128,
            ),
            time: r?.time === null || r?.time === undefined ? null : Number(r.time),
            text: truncateString(r?.text, 2000),
          }))
      : null;

    const normalizedEmail = email ? truncateString(email, 320) : null;

    const detailsPayload = {
      targetIconMaskBaseUri: normalizedIconMaskBaseUri,
      targetIconBackgroundColor: normalizedIconBackgroundColor,
      targetPrimaryPhotoUrl: normalizedPrimaryPhotoUrl,
      targetRating: Number.isFinite(normalizedRating) ? normalizedRating : null,
      targetUserRatingsTotal: Number.isFinite(normalizedUserRatingsTotal)
        ? normalizedUserRatingsTotal
        : null,
      targetWebsite: normalizedWebsite,
      targetGoogleUrl: normalizedGoogleUrl,
      targetFormattedPhoneNumber: normalizedFormattedPhoneNumber,
      targetInternationalPhoneNumber: normalizedInternationalPhoneNumber,
      targetTypes: normalizedTypes,
      targetReviews: normalizedReviews,
      detailsFetchedAt:
        normalizedIconMaskBaseUri ||
        normalizedPrimaryPhotoUrl ||
        Number.isFinite(normalizedRating) ||
        Number.isFinite(normalizedUserRatingsTotal) ||
        normalizedWebsite ||
        normalizedGoogleUrl ||
        normalizedFormattedPhoneNumber ||
        normalizedInternationalPhoneNumber ||
        normalizedTypes ||
        normalizedReviews
          ? new Date()
          : null,
      targetEmail: normalizedEmail,
    };

    const existing = await BusinessTagging.findOne({
      where: {
        targetPlaceId: normalizedPlaceId,
        [tagger.ownerField]: tagger.ownerId,
      },
    });

    if (existing) {
      const update = {};

      if (normalizedName && normalizedName !== existing.targetName) {
        update.targetName = normalizedName;
      }
      if (normalizedAddress !== null && normalizedAddress !== existing.targetAddress) {
        update.targetAddress = normalizedAddress;
      }

      for (const [key, value] of Object.entries(detailsPayload)) {
        if (value !== null && value !== undefined) {
          update[key] = value;
        }
      }

      if (Object.keys(update).length > 0) {
        await existing.update(update);
      }

      return res.status(200).json({
        success: true,
        message: "Business already tagged",
        data: existing,
      });
    }

    const created = await BusinessTagging.create({
      taggerUserId: tagger.taggerUserId,
      taggerBusinessId: tagger.taggerBusinessId,
      targetPlaceId: normalizedPlaceId,
      targetName: normalizedName,
      targetAddress: normalizedAddress,
      ...detailsPayload,
    });

    return res.status(201).json({
      success: true,
      message: "Business tagged successfully",
      data: created,
    });
  } catch (error) {
    console.error("Create business tagging error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// @desc    Get taggings created by the current user/business
// @route   GET /api/business-tagging/mine
// @access  Private (User or Business)
const listMyBusinessTaggings = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;

    const tagger = resolveTagger(req);
    if (!tagger) {
      return res.status(403).json({
        success: false,
        message: "Only user or business accounts can view taggings",
      });
    }

    const { count, rows } = await BusinessTagging.findAndCountAll({
      where: { [tagger.ownerField]: tagger.ownerId },
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("List my business taggings error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// @desc    Delete a tagging (only by its owner)
// @route   DELETE /api/business-tagging/:id
// @access  Private (User or Business)
const deleteBusinessTagging = async (req, res) => {
  try {
    const { id } = req.params;

    const tagger = resolveTagger(req);
    if (!tagger) {
      return res.status(403).json({
        success: false,
        message: "Only user or business accounts can delete taggings",
      });
    }

    const existing = await BusinessTagging.findOne({
      where: {
        id,
        [tagger.ownerField]: tagger.ownerId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Tagging not found",
      });
    }

    await existing.destroy();

    return res.status(200).json({
      success: true,
      message: "Tagging removed",
    });
  } catch (error) {
    console.error("Delete business tagging error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// @desc    Summary of taggers who tagged the logged-in business
// @route   GET /api/business-tagging/received/summary
// @access  Private (Business)
const getReceivedTaggingSummary = async (req, res) => {
  try {
    if (req.authType !== "business" || !req.business?.id) {
      return res.status(403).json({
        success: false,
        message: "Only business accounts can view received taggings",
      });
    }

    const placeId = req.business.placeId ? String(req.business.placeId) : "";
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message:
          "Your business is not listed on Google Maps. Please update your business profile with a Google Place ID to view who tagged your business.",
      });
    }

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

    return res.status(200).json({
      success: true,
      data: {
        totalTaggings: row?.totalTaggings || 0,
        userTaggers: row?.userTaggers || 0,
        businessTaggers: row?.businessTaggers || 0,
      },
    });
  } catch (error) {
    console.error("Get received tagging summary error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// @desc    List taggers who tagged the logged-in business
// @route   GET /api/business-tagging/received/taggers
// @access  Private (Business)
const listReceivedTaggers = async (req, res) => {
  try {
    if (req.authType !== "business" || !req.business?.id) {
      return res.status(403).json({
        success: false,
        message: "Only business accounts can view received taggings",
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const offset = (page - 1) * limit;

    const placeId = req.business.placeId ? String(req.business.placeId) : "";
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message:
          "Your business is not listed on Google Maps. Please update your business profile with a Google Place ID to view who tagged your business.",
      });
    }

    const { count, rows } = await BusinessTagging.findAndCountAll({
      where: { targetPlaceId: placeId },
      include: [
        {
          model: User,
          as: "taggerUser",
          required: false,
          attributes: ["id", "fullName", "email", "avatarUrl"],
        },
        {
          model: Business,
          as: "taggerBusiness",
          required: false,
          attributes: ["id", "name", "email", "businessAddress"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const data = rows.map((row) => {
      const plain = row.toJSON();
      if (plain.taggerUser) {
        return {
          taggerType: "user",
          taggedAt: plain.createdAt,
          tagger: plain.taggerUser,
        };
      }
      if (plain.taggerBusiness) {
        return {
          taggerType: "business",
          taggedAt: plain.createdAt,
          tagger: plain.taggerBusiness,
        };
      }
      return {
        taggerType: "unknown",
        taggedAt: plain.createdAt,
        tagger: null,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("List received taggers error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

module.exports = {
  createBusinessTagging,
  listMyBusinessTaggings,
  deleteBusinessTagging,
  getReceivedTaggingSummary,
  listReceivedTaggers,
};
