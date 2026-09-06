const express = require("express");
const multer = require("multer");
const router = express.Router();
const {
  createPromotion,
  getBusinessPromotions,
  updatePromotion,
  deletePromotion,
  getDashboard,
  activatePromotion,
  deactivatePromotion,
  getPromotionById,
} = require("../controllers/businessController");
const {
  createBusinessPromotionTemplate,
  getBusinessPromotionTemplates,
  getBusinessPromotionTemplateById,
  updateBusinessPromotionTemplate,
  deleteBusinessPromotionTemplate,
} = require("../controllers/businessPromotionTemplateController");
const {
  getBusinessProfile,
  updateBusinessProfile,
} = require("../controllers/businessProfileController");
const { protect } = require("../middleware/authMiddleware");
const { requireActiveSubscription } = require("../middleware/subscriptionMiddleware");
const { validatePromotion } = require("../middleware/validationMiddleware");
const { uploadPromotionImage } = require("../controllers/promotionImageController");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});
const promotionImageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

router.use(protect("business"));

router.get("/dashboard", getDashboard);
router.get("/profile", getBusinessProfile);
router.put("/profile", upload.single("logo"), updateBusinessProfile);
router.post(
  "/promotion-image",
  requireActiveSubscription,
  promotionImageUpload.single("image"),
  uploadPromotionImage,
);
router.post(
  "/promotions",
  requireActiveSubscription,
  validatePromotion,
  createPromotion,
);
router.get("/promotions", getBusinessPromotions);
router.get("/promotions/:promotionId", getPromotionById);
router.put("/promotions/:id", updatePromotion);
router.delete("/promotions/:id", deletePromotion);
router.post("/promotions/:promotionId/activate", activatePromotion);
router.post("/promotions/:promotionId/deactivate", deactivatePromotion);
router.get("/promotion-templates", getBusinessPromotionTemplates);
router.get("/promotion-templates/:id", getBusinessPromotionTemplateById);
router.post("/promotion-templates", createBusinessPromotionTemplate);
router.put("/promotion-templates/:id", updateBusinessPromotionTemplate);
router.delete("/promotion-templates/:id", deleteBusinessPromotionTemplate);

module.exports = router;
