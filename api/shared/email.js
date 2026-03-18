const { logEvent } = require('./events');

function normalizeConnectionString(value) {
  return String(value || '').replace(/(^|;)eendpoint=/i, '$1endpoint=').trim();
}

function getEmailSdk() {
  return require('@azure/communication-email');
}

function getEmailClient() {
  const raw = process.env.ACS_CONNECTION || '';
  const connectionString = normalizeConnectionString(raw);
  if (!connectionString) return null;
  const { EmailClient } = getEmailSdk();
  return new EmailClient(connectionString);
}

function getSender() {
  return String(process.env.FROM_EMAIL || '').trim();
}

function buildRecipients(to) {
  const values = Array.isArray(to) ? to : [to];
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((address) => ({ address }));
}

async function sendEmail({ to, subject, html, text }) {
  const client = getEmailClient();
  const sender = getSender();
  const recipients = buildRecipients(to);

  if (!client || !sender || !recipients.length) {
    return { skipped: true, reason: 'missing_email_configuration' };
  }

  const poller = await client.beginSend({
    senderAddress: sender,
    content: {
      subject: String(subject || '').trim() || 'Notificación de eSign Demo',
      plainText: text || '',
      html: html || undefined
    },
    recipients: {
      to: recipients
    }
  });

  const result = await poller.pollUntilDone();
  if (result?.status && result.status !== 'Succeeded') {
    throw new Error(`ACS email status: ${result.status}`);
  }

  return { skipped: false, status: result?.status || 'Succeeded', id: result?.id || null };
}

function renderList(items) {
  return items.map((item) => `<li>${item}</li>`).join('');
}

async function sendAgreementNotification(agreement, options) {
  const notifyEmail = String(options?.notifyEmail || agreement?.notifyEmail || '').trim();
  if (!notifyEmail) return { skipped: true, reason: 'missing_notify_email' };

  return sendEmail({
    to: notifyEmail,
    subject: options.subject,
    text: options.text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1e293b">
        <h2 style="margin:0 0 12px;color:#e60045">${options.heading || options.subject}</h2>
        <p>${options.intro || ''}</p>
        ${options.items?.length ? `<ul>${renderList(options.items)}</ul>` : ''}
        ${options.footer ? `<p>${options.footer}</p>` : ''}
      </div>
    `
  });
}

async function safeSendAgreementNotification(context, agreementId, agreement, options, eventType) {
  try {
    const result = await sendAgreementNotification(agreement, options);
    if (!result.skipped && eventType) {
      await logEvent(agreementId, eventType, {
        to: String(options?.notifyEmail || agreement?.notifyEmail || '').trim(),
        subject: options?.subject || '',
        status: result.status || 'Succeeded'
      }).catch(() => {});
    }
    return result;
  } catch (err) {
    context?.log?.warn?.(`Email notification failed for ${agreementId}: ${err.message || err}`);
    await logEvent(agreementId, `${eventType || 'EmailNotification'}Failed`, {
      to: String(options?.notifyEmail || agreement?.notifyEmail || '').trim(),
      subject: options?.subject || '',
      error: String(err?.message || err)
    }).catch(() => {});
    return { skipped: true, reason: 'send_failed', error: String(err?.message || err) };
  }
}

module.exports = {
  normalizeConnectionString,
  sendEmail,
  sendAgreementNotification,
  safeSendAgreementNotification
};
