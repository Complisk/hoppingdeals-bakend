const { validationResult } = require("express-validator");
const SupportMessage = require("../models/SupportMessage");
const {
  sendSupportAutoReply,
  sendSupportAdminNotification,
} = require("../services/emailService");

// @desc    Create support message (customer/business)
// @route   POST /api/support/messages
// @access  Public
const createSupportMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation failed", errors: errors.array() });
    }

    const { senderType, name, email, subject, body } = req.body;

    const message = await SupportMessage.create({
      senderType,
      name,
      email,
      subject,
      body,
      ipAddress:
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null,
      userAgent: req.headers["user-agent"] || null,
      meta: {
        authType: req.authType || null,
        userId: req.user?.id || null,
        businessId: req.business?.id || null,
        referer: req.headers.referer || null,
      },
    });

    // Email notifications are best-effort: saving to DB is the source of truth.
    // Send both the customer auto-reply and an admin notification.
    try {
      await Promise.allSettled([
        sendSupportAutoReply(message),
        sendSupportAdminNotification(message),
      ]);
    } catch (e) {
      console.error("Support email send failed:", e?.message || e);
    }

    return res.status(201).json({
      message: "Support message submitted",
      id: message.id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createSupportMessage,
};
