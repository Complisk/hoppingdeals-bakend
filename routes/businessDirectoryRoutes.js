const express = require("express");
const router = express.Router();
const {
  getBusinessDirectory,
  getPublicBusinessProfile,
} = require("../controllers/businessDirectoryController");

// Public endpoints (no auth) — active businesses and their active promotions.
router.get("/", getBusinessDirectory);
router.get("/:id", getPublicBusinessProfile);

module.exports = router;
