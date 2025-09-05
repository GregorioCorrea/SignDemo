const { table } = require('../shared/storage');
const { issueToken } = require('../shared/tokens');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
  const { agreementId, signers, frontBaseUrl } = req.body || {};
  if (!agreementId || !Array.isArray(signers) || !frontBaseUrl) return { status: 400, body: 'Datos inválidos' };

  const Signers = table('Signers');
  const links = [];

  for (const s of signers) {
    const signerId = uuidv4();
    await Signers.createEntity({
      partitionKey: agreementId,
      rowKey: signerId,
      Email: s.email,
      Name: s.name,
      Status: 'PENDING'
    });

    const token = issueToken({ agreementId, signerId, role: 'signer' }, 120); // 2 horas
    links.push({ name: s.name, email: s.email, url: `${frontBaseUrl}/sign.html?token=${encodeURIComponent(token)}` });
  }

  return { status: 200, jsonBody: { links } };
}
