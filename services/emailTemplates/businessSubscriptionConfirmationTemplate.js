const { LOGO_URL } = require("./constants");

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDateLabel = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatPriceLabel = (value) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(numberValue);
};

const buildBusinessSubscriptionConfirmationTemplate = ({
  businessName,
  subscription,
  template,
}) => {
  const safeBusinessName = escapeHtml(businessName || "Business");
  const planName = template?.name || "Subscription Plan";
  const safePlanName = escapeHtml(planName);

  const status = String(subscription?.status || "active").toUpperCase();
  const safeStatus = escapeHtml(status);
  const startDateLabel = formatDateLabel(subscription?.startDate);
  const endDateLabel = formatDateLabel(subscription?.endDate);
  const freeCities = Number(subscription?.freeCities || 0);
  const freeStates = Number(subscription?.freeStates || 0);
  const priceLabel = formatPriceLabel(template?.price);
  const durationMonths = Number(template?.durationMonths || 0);

  const text = [
    `Hi ${businessName || "there"},`,
    "",
    "Your Hopping deals subscription is now active.",
    "",
    `Plan: ${planName}`,
    `Status: ${status}`,
    `Start Date: ${startDateLabel}`,
    `End Date: ${endDateLabel}`,
    `Price: ${priceLabel}`,
    `Duration: ${durationMonths} month${durationMonths === 1 ? "" : "s"}`,
    `Included Cities: ${freeCities}`,
    `Included States: ${freeStates}`,
    "",
    "Thank you for subscribing to Hopping deals.",
    "",
    "- Hopping deals Team",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Subscription Confirmed</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;border-collapse:separate;border-spacing:0;">
            <tr>
              <td style="padding:0 0 14px 0;" align="center">
                <img src="https://Hopping deals.com/Hopping deals%20logo%202025-12-25%20at%201,00,05%E2%80%AFPM-Picsart-BackgroundRemover%20(1).png" width="160" alt="Hopping deals" style="display:block;border:0;outline:none;text-decoration:none;max-width:160px;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:14px;padding:22px 20px;border:1px solid #e5e7eb;">
                <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.35;color:#111827;">Subscription Confirmed</h1>
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">Hi ${safeBusinessName}, your subscription is now active. Here are your plan details:</p>

                <div style="padding:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px;line-height:1.5;">
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Plan</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;" align="right">${safePlanName}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Status</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#047857;font-weight:700;" align="right">${safeStatus}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Start Date</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(startDateLabel)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">End Date</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(endDateLabel)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Price</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(priceLabel)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Duration</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(String(durationMonths))} month${durationMonths === 1 ? "" : "s"}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Included Cities</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(String(freeCities))}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Included States</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;" align="right">${escapeHtml(String(freeStates))}</td>
                    </tr>
                  </table>
                </div>

                <p style="margin:14px 0 0 0;font-size:12px;line-height:1.6;color:#6b7280;">Thank you for subscribing to Hopping deals.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 4px 0 4px;" align="center">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">&copy; ${new Date().getFullYear()} Hopping deals</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: `Subscription confirmed - ${planName}`,
    text,
    html,
  };
};

module.exports = {
  buildBusinessSubscriptionConfirmationTemplate,
};
