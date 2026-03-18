const { table } = require('../shared/storage');
const { logEvent } = require('../shared/events');

module.exports = async function (context, req) {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const agreementId = src.agreementId || src.AgreementId;
    const approvedBy = src.approvedBy || src.approver || 'system';

    if (!agreementId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'agreementId requerido' }
      };
      return;
    }

    const Agreements = table('Agreements');
    await Agreements.upsertEntity({
      partitionKey: 'AGREEMENTS',
      rowKey: agreementId,
      status: 'Approved',
      approvedBy,
      approvedUtc: new Date().toISOString()
    }, 'Merge');
    await logEvent(agreementId, 'AgreementApproved', { approvedBy }).catch(() => {});

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, status: 'Approved', approvedBy }
    };
  } catch (err) {
    context.log.error('[approve] ERROR:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'approve failed', detail: String(err?.message || err) }
    };
  }
};
