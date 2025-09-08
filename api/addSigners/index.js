const { table } = require('../shared/storage');
const { issueToken } = require('../shared/tokens');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
  try {
    const { agreementId, signers, frontBaseUrl } = req.body || {};
    if (!agreementId || !Array.isArray(signers) || !frontBaseUrl) {
      context.res = { status: 400, body: 'Datos inválidos' };
      return;
    }

    const Signers = table('Signers');
    const links = [];

    for (const s of signers) {
      const signerId = uuidv4();
      await Signers.createEntity({
        partitionKey: agreementId,
        rowKey: signerId,
        Email: s.email,
        Name: s.name,
        Status: 'PENDING',
        order: s.order ?? 0
      });

      const token = issueToken({ agreementId, signerId, role: 'signer' }, 120);
      links.push({
        name: s.name,
        email: s.email,
        url: `${frontBaseUrl}/sign.html?token=${encodeURIComponent(token)}`
      });
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, links }
    };
  } catch (err) {
    context.log.error('addSigners error', err);
    context.res = { status: 500, body: 'Error interno' };
  }
};
