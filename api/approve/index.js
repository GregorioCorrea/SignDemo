// api/approve/index.js
const { table } = require('../shared/storage');

module.exports = async function (context, req) {
  const log = (...a) => context.log('[approve]', ...a);

  try {
    log('invoke start');
    log('env check:', {
      HAS_AzureWebJobsStorage: !!process.env.AzureWebJobsStorage,
      HAS_TABLES_CONNECTION:   !!process.env.TABLES_CONNECTION,
      HAS_FUNCTIONS_WORKER_RUNTIME: !!process.env.FUNCTIONS_WORKER_RUNTIME
    });

    const src = { ...(req.query || {}), ...(req.body || {}) };
    log('input:', src);

    const agreementId = src.agreementId || src.AgreementId;
    const approvedBy  = src.approvedBy  || 'system';

    if (!agreementId) {
      log('missing agreementId');
      return { status: 400, body: 'agreementId requerido' };
    }

    log('get table client: Agreements');
    const Agreements = table('Agreements');

    log('upsert merge entity…', { agreementId, approvedBy });
    await Agreements.upsertEntity(
      {
        partitionKey: 'AGREEMENTS',
        rowKey: agreementId,
        status: 'Approved',
        approvedBy,
        approvedUtc: new Date().toISOString()
      },
      'Merge'
    );

    log('upsert ok');
    return {
      status: 200,
      jsonBody: { ok: true, agreementId, status: 'Approved', approvedBy }
    };
  } catch (err) {
    // volcamos lo más útil posible
    const msg = (err && (err.message || err.toString())) || 'unknown';
    const code = err && err.code;
    const stack = err && err.stack;
    context.log.error('[approve] ERROR:', { msg, code, stack });
    return { status: 500, body: `approve failed: ${msg}${code ? ` (${code})` : ''}` };
  }
};
