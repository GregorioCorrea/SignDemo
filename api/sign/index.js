const { table } = require('../shared/storage');
const { verifyToken } = require('../shared/tokens'); // ya existe con el cambio de arriba

module.exports = async function (context, req) {
  try {
    const auth = (req.headers['authorization'] || '').trim();
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
    const token = req.query.token || (req.body && req.body.token) || bearer;
    if (!token) { context.res = { status: 400, body: 'Falta token' }; return; }

    let payload;
    try { payload = verifyToken(token); }
    catch (e) { context.res = { status: 401, body: 'Token inválido' }; return; }

    const { agreementId, signerId } = payload || {};
    if (!agreementId || !signerId) { context.res = { status: 400, body: 'Token sin datos requeridos' }; return; }

    const Signers = table('Signers');
    const now = new Date().toISOString();
    const ip = (req.body && req.body.ip) || req.headers['x-forwarded-for'] || '';

    await Signers.updateEntity({
      partitionKey: agreementId,
      rowKey: signerId,
      Status: 'SIGNED',
      signedUtc: now,
      ip: String(ip)
    }, 'Merge');

    // Marcar Agreement si ya firmaron todos
    const pending = [];
    for await (const e of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
      if (String(e.Status).toUpperCase() !== 'SIGNED') pending.push(e);
    }
    if (pending.length === 0) {
      const Agreements = table('Agreements');
      await Agreements.updateEntity({
        partitionKey: 'AGREEMENTS',
        rowKey: agreementId,
        status: 'FullySigned',
        fullySignedUtc: now
      }, 'Merge');
    }

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, signerId, status: 'SIGNED', when: now } };
  } catch (err) {
    context.log.error('Error en /sign', err);
    context.res = { status: 500, body: 'Error interno' };
  }
};
