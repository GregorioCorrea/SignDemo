const { table, sasForBlob, containers } = require('../shared/storage');
const { listEvents } = require('../shared/events');
const crypto = require('crypto');

async function blobExists(containerClient, blobName) {
  if (!blobName) return false;
  try {
    return await containerClient.getBlockBlobClient(blobName).exists();
  } catch (err) {
    return false;
  }
}

async function downloadBlob(containerClient, blobName) {
  const response = await containerClient.getBlockBlobClient(blobName).download();
  const chunks = [];
  for await (const chunk of response.readableStreamBody) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function firstExistingBlob(containerClient, candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await blobExists(containerClient, candidate)) return candidate;
  }
  return null;
}

function normalizeStatus(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'Created';
  if (/counter/i.test(value)) return 'CounterSigned';
  if (/fully/i.test(value)) return 'FullySigned';
  if (/partial/i.test(value)) return 'PartiallySigned';
  if (/approved/i.test(value)) return 'Approved';
  if (/ready_for_countersign/i.test(value)) return 'FullySigned';
  return value;
}

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

    const agreementsContainer = containers.agreements();
    const signaturesContainer = containers.signatures();
    const signedContainer = containers.signed();

    const originalBlob = await firstExistingBlob(agreementsContainer, [
      agreement.pdfBlob,
      `${agreementId}/original.pdf`,
      `${agreementId}.pdf`
    ]);

    const finalPdfBlob = await firstExistingBlob(signedContainer, [
      agreement.finalPdfBlob,
      `${agreementId}.pdf`,
      `${agreementId}/final.pdf`
    ]);

    let pdfSha256 = agreement.pdfSha256 || null;
    if (!pdfSha256 && originalBlob) {
      try {
        pdfSha256 = crypto.createHash('sha256')
          .update(await downloadBlob(agreementsContainer, originalBlob))
          .digest('hex');
      } catch (err) {
        context.log.warn('getAgreementDetail sha256 fallback failed', agreementId, err?.message || err);
      }
    }

    const signers = [];
    for await (const entity of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
      const signerId = entity.rowKey;
      const signatureBlob = await firstExistingBlob(signaturesContainer, [
        entity.SignatureBlob,
        `${agreementId}/${signerId}.png`
      ]);
      const strokesBlob = await firstExistingBlob(signaturesContainer, [
        entity.StrokesBlob,
        `${agreementId}/${signerId}.json`
      ]);
      const partialPdfBlob = await firstExistingBlob(agreementsContainer, [
        entity.SignedPdfBlob,
        `${agreementId}/partial/${signerId}.pdf`
      ]);
      const individualSignedBlob = await firstExistingBlob(signedContainer, [
        `${agreementId}/${signerId}.pdf`
      ]);

      const signedUtc = entity.SignedUtc || entity.SignedAtUtc || entity.signedUtc || null;
      const ip = entity.Ip || entity.ip || null;
      const userAgent = entity.UserAgent || entity.userAgent || null;
      const signerName = entity.Name || '';
      const signerEmail = entity.Email || '';
      const status = normalizeStatus(entity.Status || entity.status || 'PENDING');

      signers.push({
        signerId,
        name: signerName,
        email: signerEmail,
        status,
        signedUtc,
        ip,
        userAgent,
        signatureUrl: signatureBlob ? sasForBlob('signatures', signatureBlob, 60) : null,
        strokesUrl: strokesBlob ? sasForBlob('signatures', strokesBlob, 60) : null,
        partialPdfUrl: partialPdfBlob ? sasForBlob('agreements', partialPdfBlob, 60) : null,
        signedPdfUrl: individualSignedBlob ? sasForBlob('signed', individualSignedBlob, 60) : null,
        operationRecord: {
          pdfSha256,
          signedUtc,
          ip,
          userAgent,
          consent: true
        }
      });
    }

    signers.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    const signerCount = signers.length;
    const signedCount = signers.filter((signer) => String(signer.status).toUpperCase() === 'SIGNED').length;

    const derivedEvents = [];
    if (agreement.createdUtc) {
      derivedEvents.push({
        type: 'AgreementCreated',
        createdUtc: agreement.createdUtc,
        payload: {
          createdBy: agreement.createdBy || null,
          pdfSha256
        }
      });
    }
    if (agreement.approvedUtc) {
      derivedEvents.push({
        type: 'AgreementApproved',
        createdUtc: agreement.approvedUtc,
        payload: { approvedBy: agreement.approvedBy || null }
      });
    }
    for (const signer of signers) {
      if (!signer.signedUtc) continue;
      derivedEvents.push({
        type: 'SignerCompleted',
        createdUtc: signer.signedUtc,
        payload: {
          signerId: signer.signerId,
          signerName: signer.name,
          signerEmail: signer.email,
          ip: signer.ip,
          pdfSha256
        }
      });
    }
    if (agreement.countersignedUtc) {
      derivedEvents.push({
        type: 'CounterSigned',
        createdUtc: agreement.countersignedUtc,
        payload: { countersignedBy: agreement.countersignedBy || null }
      });
    }

    const storedEvents = await listEvents(agreementId).catch(() => []);
    const events = [...derivedEvents, ...storedEvents]
      .sort((a, b) => String(b.createdUtc || '').localeCompare(String(a.createdUtc || '')));

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        ok: true,
        agreement: {
          agreementId,
          title: agreement.title || '',
          createdBy: agreement.createdBy || '',
          status: normalizeStatus(agreement.status || agreement.Status || 'Created'),
          createdUtc: agreement.createdUtc || null,
          approvedUtc: agreement.approvedUtc || null,
          fullySignedUtc: agreement.fullySignedUtc || null,
          countersignedUtc: agreement.countersignedUtc || null,
          pdfSha256,
          originalPdfUrl: originalBlob ? sasForBlob('agreements', originalBlob, 60) : null,
          finalPdfUrl: finalPdfBlob ? sasForBlob('signed', finalPdfBlob, 60) : null,
          signerCount,
          signedCount
        },
        signers,
        events
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
