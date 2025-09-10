const { table } = require('../shared/storage');
const { issueToken } = require('../shared/tokens');
const { randomUUID } = require('crypto'); // <- nativo en Node 18

module.exports = async function (context, req) {
  try {
    const { agreementId, signers, frontBaseUrl } = (req.body || {});
    if (!agreementId || !Array.isArray(signers) || !frontBaseUrl) {
      return { status: 400, body: 'Datos inválidos' };
    }

    const Signers = table('Signers');
    const links = [];

    for (const s of signers) {
      const signerId = randomUUID();
      await Signers.createEntity({
        partitionKey: agreementId,
        rowKey: signerId,
        Email: s.email,
        Name: s.name,
        Status: 'PENDING',
        Order: s.order ?? 0
      });

      const token = issueToken({ agreementId, signerId, role: 'signer' }, 120); // 2h
      links.push({
        name: s.name,
        email: s.email,
        token, // <-- te lo devuelvo directo
        url: `${frontBaseUrl}/sign.html?token=${encodeURIComponent(token)}`
      });
    }

    return {
      status: 200,
      jsonBody: { ok: true, agreementId, links }
    };
  } catch (err) {
    context.log.error('addSigners error', err?.stack || String(err));
    return { status: 500, body: 'Error interno' };
  }
};