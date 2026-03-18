const { table, sasForBlob } = require('../shared/storage');
const { listEvents } = require('../shared/events');

module.exports = async function (context, req) {
  try {
    const agreementId = String(req.query?.agreementId || req.body?.agreementId || '').trim();
    if (!agreementId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'agreementId requerido' }
      };
      return;
    }

    const Agreements = table('Agreements');
    const Signers = table('Signers');
    const agreement = await Agreements.getEntity('AGREEMENTS', agreementId).catch(() => null);
    if (!agreement) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Acuerdo no encontrado' }
      };
      return;
    }

    const signers = [];
    for await (const entity of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
      signers.push({
        signerId: entity.rowKey,
        name: entity.Name || '',
        email: entity.Email || '',
        status: entity.Status || 'PENDING',
        signedUtc: entity.SignedUtc || null,
        ip: entity.Ip || null,
        userAgent: entity.UserAgent || null,
        signatureUrl: entity.SignatureBlob ? sasForBlob('signatures', entity.SignatureBlob, 60) : null,
        manifestUrl: entity.ManifestBlob ? sasForBlob('signatures', entity.ManifestBlob, 60) : null,
        signedPdfUrl: entity.SignedPdfBlob ? sasForBlob('signed', entity.SignedPdfBlob, 60) : null
      });
    }

    signers.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    const signerCount = signers.length;
    const signedCount = signers.filter((signer) => String(signer.status).toUpperCase() === 'SIGNED').length;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        ok: true,
        agreement: {
          agreementId,
          title: agreement.title || '',
          createdBy: agreement.createdBy || '',
          status: agreement.status || 'Created',
          createdUtc: agreement.createdUtc || null,
          approvedUtc: agreement.approvedUtc || null,
          fullySignedUtc: agreement.fullySignedUtc || null,
          countersignedUtc: agreement.countersignedUtc || null,
          pdfSha256: agreement.pdfSha256 || null,
          originalPdfUrl: agreement.pdfContainer && agreement.pdfBlob ? sasForBlob(agreement.pdfContainer, agreement.pdfBlob, 60) : null,
          finalPdfUrl: agreement.finalPdfContainer && agreement.finalPdfBlob ? sasForBlob(agreement.finalPdfContainer, agreement.finalPdfBlob, 60) : null,
          signerCount,
          signedCount
        },
        signers,
        events: await listEvents(agreementId).catch(() => [])
      }
    };
  } catch (err) {
    context.log.error('getAgreementDetail error', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'InternalError', detail: String(err?.message || err) }
    };
  }
};
