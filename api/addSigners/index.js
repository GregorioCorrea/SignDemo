const { table } = require('../shared/storage');
const { issueToken } = require('../shared/tokens');
const { randomUUID } = require('crypto');
const { logEvent } = require('../shared/events');

module.exports = async function (context, req) {
  try {
    const { agreementId, signers, frontBaseUrl } = req.body || {};
    if (!agreementId || !Array.isArray(signers) || !frontBaseUrl) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Datos inválidos' }
      };
      return;
    }

    const Agreements = table('Agreements');
    const Signers = table('Signers');
    await Signers.createTable({ onResponse: () => {} }).catch(() => {});

    const agreement = await Agreements.getEntity('AGREEMENTS', agreementId).catch(() => null);
    if (!agreement) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Acuerdo no encontrado' }
      };
      return;
    }

    const links = [];
    for (const signerInput of signers) {
      if (!signerInput || !signerInput.email) continue;

      const signerId = randomUUID();
      const signerName = (signerInput.name || '').trim();
      const signerEmail = String(signerInput.email).trim();
      const token = issueToken({ agreementId, signerId, role: 'signer' }, 120);
      const signUrl = `${frontBaseUrl}/sign.html?token=${encodeURIComponent(token)}`;
      await Signers.upsertEntity({
        partitionKey: agreementId,
        rowKey: signerId,
        Email: signerEmail,
        Name: signerName,
        Status: 'PENDING',
        Order: signerInput.order ?? 0,
        SignToken: token,
        SignUrl: signUrl
      }, 'Merge');

      links.push({
        name: signerName,
        email: signerEmail,
        token,
        url: signUrl
      });

      await logEvent(agreementId, 'SignerAdded', {
        signerId,
        name: signerName,
        email: signerEmail,
        signUrl
      }).catch(() => {});
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, count: links.length, links }
    };
  } catch (err) {
    context.log.error('addSigners error', err?.stack || String(err));
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Error interno', detail: String(err?.message || err) }
    };
  }
};
