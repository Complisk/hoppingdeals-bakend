const { escapeHtml, wrapEmailTemplate } = require("./templateUtils");

const buildForgotPasswordTemplate = ({
  displayName,
  accountType,
  resetUrl,
  expiresInMinutes = 60,
}) => {
  const name = displayName || "there";
  const accountLabel = accountType === "business" ? "business" : "user";
  const safeName = escapeHtml(name);
  const safeAccountLabel = escapeHtml(accountLabel);
  const safeResetUrl = escapeHtml(resetUrl);
  const safeExpiry = escapeHtml(String(expiresInMinutes));

  const text = [
    `Hi ${name},`,
    "",
    `We received a password reset request for your Hopping deals ${accountLabel} account.`,
    "",
    `Reset your password: ${resetUrl}`,
    "",
    `For security, this link will expire in ${expiresInMinutes} minutes.`,
    "If you did not request a reset, you can safely ignore this email.",
    "",
    "Hopping deals Team",
  ].join("\n");

  const html = wrapEmailTemplate({
    title: "Reset your Hopping deals password",
    preheader: "Use this secure link to reset your password.",
    bodyHtml: `
      <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.35;color:#111827;">Reset your password</h1>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">Hi ${safeName}, we received a request to reset your Hopping deals ${safeAccountLabel} account password.</p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#374151;">To continue, use the secure button below. For your protection, this link expires in ${safeExpiry} minutes.</p>
      <p style="margin:0 0 16px 0;">
        <a href="${safeResetUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;">Reset Password</a>
      </p>
      <p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:#6b7280;">If the button does not work, copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;font-size:12px;line-height:1.6;color:#2563eb;word-break:break-all;">${safeResetUrl}</p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">If you did not request this, no action is needed.</p>
    `,
  });

  return {
    subject: "Reset your Hopping deals password",
    text,
    html,
  };
};

module.exports = {
  buildForgotPasswordTemplate,
};
