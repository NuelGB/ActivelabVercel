const { google } = require("googleapis");
require("dotenv").config();

// ─── OAuth2 Client ───────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.OAUTH_CLIENT_ID,
  process.env.OAUTH_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.OAUTH_REFRESH_TOKEN,
});

// Gmail API client (panggil lewat HTTPS ke gmail.googleapis.com, BUKAN SMTP)
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// ─── Helper: encode pesan ke format Gmail API (base64url) ───────
const encodeMessage = ({ to, from, subject, html, text }) => {
  // Pakai boundary multipart sederhana: text + html
  const boundary = "activelab_boundary_" + Date.now();

  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    text || "",
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
    "",
    `--${boundary}--`,
  ];

  const message = messageParts.join("\r\n");

  // Gmail API butuh base64url (bukan base64 biasa)
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

// ─── Helper: kirim email via Gmail API ───────────────────────────
const sendMail = async ({ to, subject, html, text }) => {
  try {
    const raw = encodeMessage({
      to,
      from: `"ActiveLab" <${process.env.GMAIL_USER}>`,
      subject,
      html,
      text,
    });

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    console.log(`✉️ Email berhasil dikirim via Gmail API. ID: ${result.data.id}`);
    return result;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ Gagal mengirim email via Gmail API:", JSON.stringify(detail));
    throw err;
  }
};

// ─── Email HTML template helper ───────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
      <tr><td style="background:#0d6efd;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">Activelab</h1>
        <p style="color:#cfe2ff;margin:8px 0 0;font-size:13px;">ActiveLab Management</p>
      </td></tr>
      <tr><td style="padding:36px 40px;">${content}</td></tr>
      <tr><td style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #dee2e6;text-align:center;">
        <p style="color:#adb5bd;font-size:12px;margin:0;">
          Email otomatis dari Activelab. Jangan balas email ini.<br/>
          © ${new Date().getFullYear()} Activelab. All rights reserved.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

/**
 * Kirim email reset password — ADMIN
 */
const sendAdminResetPasswordEmail = async (toEmail, resetToken) => {
  const resetUrl = `${process.env.ADMIN_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2 style="color:#212529;font-size:20px;margin:0 0 16px;">Reset Password Admin</h2>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Kami menerima permintaan reset password untuk akun admin <strong>${toEmail}</strong>.
      Klik tombol di bawah untuk membuat password baru.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center" style="padding:8px 0 32px;">
        <a href="${resetUrl}" style="background:#0d6efd;color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:bold;display:inline-block;">
          Reset Password Sekarang
        </a>
      </td></tr>
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:14px;margin-bottom:24px;">
      <p style="color:#856404;font-size:13px;margin:0;">
        ⏰ Link berlaku <strong>${expiresMin} menit</strong> dan hanya bisa digunakan sekali.
      </p>
    </div>
    <p style="color:#6c757d;font-size:12px;margin:0;">
      Jika tidak merasa meminta reset, abaikan email ini.
    </p>
    <p style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;padding:10px;font-size:11px;color:#0d6efd;word-break:break-all;margin-top:12px;">
      ${resetUrl}
    </p>`;

  await sendMail({
    to: toEmail,
    subject: "Reset Password Admin — Activelab",
    html: baseTemplate(content),
    text: `Reset password admin: ${resetUrl}`,
  });
};

/**
 * Kirim email reset password — USER (Flutter)
 */
const sendUserResetPasswordEmail = async (toEmail, userName, resetToken) => {
  const resetUrl = `${process.env.USER_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2 style="color:#212529;font-size:20px;margin:0 0 16px;">Reset Password Akun ActiveLab</h2>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 8px;">
      Halo <strong>${userName || toEmail}</strong>,
    </p>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Kami menerima permintaan reset password untuk akun ActiveLab Anda.
      Buka link di bawah melalui browser untuk membuat password baru.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center" style="padding:8px 0 32px;">
        <a href="${resetUrl}" style="background:#4285F4;color:#fff;text-decoration:none;padding:14px 36px;border-radius:30px;font-size:15px;font-weight:bold;display:inline-block;">
          Reset Password
        </a>
      </td></tr>
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:14px;margin-bottom:24px;">
      <p style="color:#856404;font-size:13px;margin:0;">
        ⏰ Link berlaku <strong>${expiresMin} menit</strong>. Setelah reset berhasil, login kembali di aplikasi ActiveLab.
      </p>
    </div>
    <p style="color:#6c757d;font-size:12px;margin:0;">
      Jika tidak merasa meminta reset, abaikan email ini. Password Anda tidak berubah.
    </p>
    `;

  await sendMail({
    to: toEmail,
    subject: "Reset Password — Activelab",
    html: baseTemplate(content),
    text: `Reset password Anda: ${resetUrl}`,
  });
};

module.exports = {
  sendAdminResetPasswordEmail,
  sendUserResetPasswordEmail,
};