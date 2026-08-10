const { escapeHtml, wrapEmailTemplate } = require("./templateUtils");

const buildBusinessRegistrationWelcomeTemplate = ({
  businessName,
  personName,
}) => {
  const safeBusinessName = escapeHtml(businessName || "your business");
  const safePersonName = escapeHtml(personName || "there");

  const text = [
    `Hi ${personName || "there"},`,
    "",
    `Welcome to Hopping deals. Your business "${businessName || "your business"}" has been registered successfully.`,
    "",
    "You can now sign in to your business dashboard and start creating promotions.",
    "",
    "Hopping deals Team",
  ].join("\n");

  const html = wrapEmailTemplate({
    title: "Welcome to Hopping deals",
    preheader: "Your business registration is complete.",
    bodyHtml: `
      <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.35;color:#111827;">Welcome to Hopping deals</h1>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">Hi ${safePersonName}, your business <strong>${safeBusinessName}</strong> has been registered successfully.</p>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">Your account is ready. You can now sign in and start creating promotions for your local customers.</p>
      <div style="padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">Need help? Contact our support team and include your business email for faster assistance.</p>
      </div>
    `,
  });

  return {
    subject: "Your Hopping deals business account is ready",
    text,
    html,
  };
};

const buildBusinessRegistrationNotificationTemplate = ({ business }) => {
  const name = business?.name || "N/A";
  const email = business?.email || "N/A";
  const phone = business?.phone || "N/A";
  const categories = Array.isArray(business?.categories)
    ? business.categories.join(", ")
    : business?.categories || "N/A";
  const personName = business?.personName || "N/A";
  const address = business?.businessAddress || "N/A";
  const placeId = business?.placeId || "N/A";
  const timezone = business?.timezone || "UTC";

  const text = [
    "A new business has registered on Hopping deals.",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Categories: ${categories}`,
    `Contact Person: ${personName}`,
    `Address: ${address}`,
    `Place ID: ${placeId}`,
    `Timezone: ${timezone}`,
  ].join("\n");

  const html = wrapEmailTemplate({
    title: `New Business Registration: ${name}`,
    preheader: `New business registered: ${name}`,
    bodyHtml: `
      <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.35;color:#111827;">New business registration</h1>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">A new business has joined Hopping deals. Details are listed below.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px;line-height:1.6;color:#111827;">
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;width:160px;"><strong>Name</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Email</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Phone</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Categories</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(categories)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Contact Person</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(personName)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Address</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(address)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Place ID</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(placeId)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid #e5e7eb;"><strong>Timezone</strong></td><td style="padding:6px 0;border-top:1px solid #e5e7eb;">${escapeHtml(timezone)}</td></tr>
      </table>
    `,
  });

  return {
    subject: `New Business Registration: ${name}`,
    text,
    html,
  };
};

module.exports = {
  buildBusinessRegistrationWelcomeTemplate,
  buildBusinessRegistrationNotificationTemplate,
};
