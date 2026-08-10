const { LOGO_URL } = require("./constants");

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const wrapEmailTemplate = ({
  title,
  preheader = "",
  bodyHtml,
  footerNote = "This is an automated transactional email from Hopping deals.",
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;">
      ${escapeHtml(preheader)}
    </div>
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
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 4px 0 4px;" align="center">
                <p style="margin:0 0 4px 0;font-size:12px;line-height:1.6;color:#6b7280;">${escapeHtml(
                  footerNote,
                )}</p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">&copy; ${new Date().getFullYear()} Hopping deals</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

module.exports = {
  escapeHtml,
  wrapEmailTemplate,
};
