const { Resend } = require("resend");
const {
  buildBusinessSubscriptionConfirmationTemplate,
} = require("./emailTemplates/businessSubscriptionConfirmationTemplate");
const {
  buildForgotPasswordTemplate,
} = require("./emailTemplates/forgotPasswordTemplate");
const {
  buildBusinessRegistrationWelcomeTemplate,
  buildBusinessRegistrationNotificationTemplate,
} = require("./emailTemplates/businessRegistrationTemplate");
const {
  escapeHtml,
  wrapEmailTemplate,
} = require("./emailTemplates/templateUtils");

const hasResendConfig = () => Boolean(process.env.RESEND_API_KEY);

const DEFAULT_FROM = "Hopping deals <noreply@Hopping deals.com>";

let cachedResend = null;

const getResend = () => {
  if (cachedResend) return cachedResend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  cachedResend = new Resend(apiKey);
  return cachedResend;
};

const resolveFrom = () => process.env.RESEND_FROM || DEFAULT_FROM;
const resolveReplyTo = () => process.env.RESEND_REPLY_TO || undefined;

const resolveBusinessNotificationRecipients = () => {
  const raw =
    process.env.BUSINESS_REGISTRATION_NOTIFY_EMAILS ||
    process.env.BUSINESS_REGISTRATION_NOTIFY_EMAIL ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    "";

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  );
};

const textToHtml = (text) =>
  `<pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;white-space:pre-wrap;line-height:1.45;">${escapeHtml(text)}</pre>`;

const buildSupportAutoReplyTemplate = (supportMessage) => {
  const name = supportMessage?.name ? String(supportMessage.name) : "there";
  const subject = supportMessage?.subject
    ? String(supportMessage.subject)
    : "your message";

  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subject);

  const text = [
    `Hi ${name},`,
    "",
    "Thanks for contacting Hopping deals. We received your message and our team will review it.",
    "",
    `Subject: ${subject}`,
    "",
    "This is an automated transactional email from Hopping deals.",
    "",
    "Hopping deals Team",
  ].join("\n");

  const html = wrapEmailTemplate({
    title: "We received your message",
    preheader: "Your support message has been received.",
    bodyHtml: `
      <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.35;color:#111827;">We received your message</h1>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">Hi ${safeName}, thanks for contacting Hopping deals. Our team will review your message and get back to you as soon as possible.</p>
      <div style="padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin:0 0 14px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#111827;"><strong>Subject:</strong> ${safeSubject}</p>
      </div>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">This is an automated transactional email from Hopping deals.</p>
    `,
  });

  return {
    subject: `We received your message: ${subject}`,
    text,
    html,
  };
};

const sendEmail = async ({
  from,
  to,
  subject,
  text,
  html,
  replyTo,
  headers,
}) => {
  if (!hasResendConfig()) {
    return { skipped: true, reason: "RESEND_API_KEY not configured" };
  }

  const resend = getResend();
  if (!resend) {
    return { skipped: true, reason: "RESEND_API_KEY not configured" };
  }

  const normalizedTo = Array.isArray(to) ? to : [to];
  const normalizedHtml = html || (text ? textToHtml(text) : undefined);

  const response = await resend.emails.send({
    from,
    to: normalizedTo,
    subject,
    ...(text ? { text } : {}),
    ...(normalizedHtml ? { html: normalizedHtml } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers ? { headers } : {}),
  });

  return {
    skipped: false,
    provider: "resend",
    id: response?.data?.id || response?.id || null,
  };
};

const sendSupportAutoReply = async (supportMessage) => {
  const from = resolveFrom();
  const { subject, text, html } = buildSupportAutoReplyTemplate(supportMessage);

  return sendEmail({
    from,
    to: supportMessage.email,
    subject,
    text,
    html,
    replyTo: resolveReplyTo(),
  });
};

const sendPasswordResetEmail = async ({
  to,
  displayName,
  accountType,
  resetUrl,
  expiresInMinutes = 60,
}) => {
  const from = resolveFrom();
  const { subject, text, html } = buildForgotPasswordTemplate({
    displayName,
    accountType,
    resetUrl,
    expiresInMinutes,
  });

  return sendEmail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: resolveReplyTo(),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
};

const sendBusinessRegistrationWelcomeEmail = async ({ business }) => {
  if (!business?.email) {
    return { skipped: true, reason: "Business email is not available" };
  }

  const from = resolveFrom();
  const { subject, text, html } = buildBusinessRegistrationWelcomeTemplate({
    businessName: business.name,
    personName: business.personName,
  });

  return sendEmail({
    from,
    to: business.email,
    subject,
    text,
    html,
    replyTo: resolveReplyTo(),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
};

const sendBusinessRegistrationNotificationEmail = async ({ business }) => {
  const recipients = resolveBusinessNotificationRecipients();
  if (!recipients.length) {
    return {
      skipped: true,
      reason:
        "No business registration recipients configured (BUSINESS_REGISTRATION_NOTIFY_EMAILS)",
    };
  }

  const from = resolveFrom();
  const { subject, text, html } = buildBusinessRegistrationNotificationTemplate(
    { business },
  );

  return sendEmail({
    from,
    to: recipients,
    subject,
    text,
    html,
    replyTo: resolveReplyTo(),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
};

const sendBusinessRegistrationEmails = async ({ business }) => {
  const [welcome, notification] = await Promise.allSettled([
    sendBusinessRegistrationWelcomeEmail({ business }),
    sendBusinessRegistrationNotificationEmail({ business }),
  ]);

  return {
    welcome:
      welcome.status === "fulfilled"
        ? welcome.value
        : { skipped: true, reason: welcome.reason?.message || "Failed" },
    notification:
      notification.status === "fulfilled"
        ? notification.value
        : { skipped: true, reason: notification.reason?.message || "Failed" },
  };
};

const sendBusinessSubscriptionConfirmationEmail = async ({
  business,
  subscription,
  template,
}) => {
  if (!business?.email) {
    return { skipped: true, reason: "Business email is not available" };
  }

  const from = resolveFrom();
  const { subject, text, html } = buildBusinessSubscriptionConfirmationTemplate(
    {
      businessName: business?.name,
      subscription,
      template,
    },
  );

  return sendEmail({
    from,
    to: business.email,
    subject,
    text,
    html,
    replyTo: resolveReplyTo(),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
};

module.exports = {
  sendSupportAutoReply,
  sendPasswordResetEmail,
  sendBusinessRegistrationWelcomeEmail,
  sendBusinessRegistrationNotificationEmail,
  sendBusinessRegistrationEmails,
  sendBusinessSubscriptionConfirmationEmail,
};
