const { table, sasForBlob, containers } = require('../shared/storage');
const { verifyToken } = require('../shared/tokens');

async function blobExists(containerClient, blobName) {
  if (!blobName) return false;
  try {
    return await containerClient.getBlockBlobClient(blobName).exists();
  } catch (err) {
    return false;
  }
}

module.exports = async function (context, req) {
  try {
    const token = (req.query.token || req.body?.token || '').trim();
    let container = (req.query.container || req.body?.container || '').trim();
    let blob = (req.query.blob || req.body?.blob || '').trim();
    let title = null;

    if (token) {
      let payload;
      try {
        payload = verifyToken(token);
      } catch (err) {
        context.res = {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { ok: false, error: 'Token inválido' }
        };
        return;
      }

      const agreementId = payload?.agreementId;
      if (!agreementId) {
        context.res = {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: { ok: false, error: 'Token sin agreementId' }
        };
        return;
      }

      const Agreements = table('Agreements');
      const agreement = await Agreements.getEntity('AGREEMENTS', agreementId).catch(() => null);
      if (!agreement) {
        context.res = {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { ok: false, error: 'Acuerdo no encontrado' }
        };
        return;
      }

      const agreementsContainer = containers.agreements();
      const candidates = [
        agreement.pdfBlob,
        `${agreementId}/original.pdf`,
        `${agreementId}.pdf`
      ].filter(Boolean);

      for (const candidate of candidates) {
        if (await blobExists(agreementsContainer, candidate)) {
          container = 'agreements';
          blob = candidate;
          break;
        }
      }
      title = agreement.title || null;
    }

    if (!container || !blob) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: "Faltan 'container' y/o 'blob'." }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, url: sasForBlob(container, blob, 60), container, blob, title }
    };
  } catch (err) {
    context.log.error('getPdfSas error:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'InternalError', detail: String(err?.message || err) }
    };
  }
};
