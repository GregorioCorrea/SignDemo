const { table, containers } = require('../shared/storage');
const { verifyToken } = require('../shared/tokens');
const { PDFDocument } = require('pdf-lib');
const crypto = require('crypto');
const { logEvent } = require('../shared/events');

module.exports = async function (context, req) {
  try {
    const auth = ((req.headers && req.headers.authorization) || '').trim();
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
    const body = req.body || {};
    const token = req.query.token || body.token || bearer;

    if (!token) {
      context.res = { status: 400, body: { ok: false, error: 'Falta token' } };
      return;
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      context.res = { status: 401, body: { ok: false, error: 'Token inválido' } };
      return;
    }

    const { agreementId, signerId } = payload || {};
    if (!agreementId || !signerId) {
      context.res = { status: 400, body: { ok: false, error: 'Token sin datos requeridos' } };
      return;
    }

    if (!body.consent) {
      context.res = { status: 400, body: { ok: false, error: 'Falta consentimiento' } };
      return;
    }
    if (!body.signaturePngBase64) {
      context.res = { status: 400, body: { ok: false, error: 'Falta firma' } };
      return;
    }

    const Agreements = table('Agreements');
    const Signers = table('Signers');
    const now = new Date().toISOString();
    const ip = body.ip || (req.headers && req.headers['x-forwarded-for']) || '';

    const agreement = await Agreements.getEntity('AGREEMENTS', agreementId).catch(() => null);
    if (!agreement) {
      context.res = { status: 404, body: { ok: false, error: 'Acuerdo no encontrado' } };
      return;
    }

    const agreementStatus = String(agreement.status || '');
    if (agreementStatus !== 'Approved' && agreementStatus !== 'PartiallySigned') {
      context.res = {
        status: 409,
        body: { ok: false, error: `Estado no habilitado para firma: ${agreementStatus || 'Sin estado'}` }
      };
      return;
    }

    const signer = await Signers.getEntity(agreementId, signerId).catch(() => null);
    if (!signer) {
      context.res = { status: 404, body: { ok: false, error: 'Firmante no encontrado' } };
      return;
    }

    await containers.signatures().createIfNotExists();
    await containers.signed().createIfNotExists();

    const signerName = String(body.signerName || signer.Name || '').trim();
    const signaturePng = Buffer.from(body.signaturePngBase64, 'base64');
    const signatureBlob = `${agreementId}/${signerId}.png`;
    const strokesBlob = `${agreementId}/${signerId}.json`;
    const manifestBlob = `${agreementId}/${signerId}-manifest.json`;

    await containers.signatures().getBlockBlobClient(signatureBlob).uploadData(signaturePng, {
      blobHTTPHeaders: { blobContentType: 'image/png' }
    });
    await containers.signatures().getBlockBlobClient(strokesBlob).uploadData(
      Buffer.from(JSON.stringify(body.signatureStrokes || [])),
      { blobHTTPHeaders: { blobContentType: 'application/json' } }
    );

    const manifest = {
      agreementId,
      signerId,
      signerEmail: signer.Email || '',
      signerName,
      pdfSha256: agreement.pdfSha256 || '',
      consent: true,
      timestampUtc: now,
      ip: String(ip),
      userAgent: body.userAgent || ''
    };
    const hmac = crypto
      .createHmac('sha256', process.env.HMAC_SECRET || 'dev-hmac-secret')
      .update(JSON.stringify(manifest))
      .digest('hex');
    await containers.signatures().getBlockBlobClient(manifestBlob).uploadData(
      Buffer.from(JSON.stringify({ ...manifest, hmac }, null, 2)),
      { blobHTTPHeaders: { blobContentType: 'application/json' } }
    );

    let signedPdfBlob = '';
    if (agreement.pdfContainer && agreement.pdfBlob) {
      const sourceBlob = containers.agreements().getBlockBlobClient(agreement.pdfBlob);
      const download = await sourceBlob.download();
      const chunks = [];
      for await (const chunk of download.readableStreamBody) chunks.push(chunk);
      const originalPdf = Buffer.concat(chunks);

      const pdfDoc = await PDFDocument.load(originalPdf);
      const png = await pdfDoc.embedPng(signaturePng);
      const page = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
      page.drawImage(png, { x: Math.max(page.getWidth() - 220, 40), y: 40, width: 180, height: 60 });
      page.drawText(`Firmante: ${signerName || signer.Email || signerId}`, { x: 40, y: 110, size: 10 });
      page.drawText(`Fecha: ${now}`, { x: 40, y: 96, size: 9 });
      page.drawText(`IP: ${String(ip || 'N/D')}`, { x: 40, y: 82, size: 9 });

      const signedPdf = await pdfDoc.save();
      signedPdfBlob = `${agreementId}/${signerId}.pdf`;
      await containers.signed().getBlockBlobClient(signedPdfBlob).uploadData(Buffer.from(signedPdf), {
        blobHTTPHeaders: { blobContentType: 'application/pdf' }
      });
    }

    await Signers.updateEntity({
      partitionKey: agreementId,
      rowKey: signerId,
      Name: signerName || signer.Name || '',
      Status: 'SIGNED',
      SignedUtc: now,
      Ip: String(ip),
      UserAgent: body.userAgent || '',
      SignatureBlob: signatureBlob,
      StrokesBlob: strokesBlob,
      ManifestBlob: manifestBlob,
      SignedPdfBlob: signedPdfBlob
    }, 'Merge');

    let pendingCount = 0;
    let totalCount = 0;
    for await (const entity of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
      totalCount += 1;
      if (String(entity.Status).toUpperCase() !== 'SIGNED') pendingCount += 1;
    }

    const nextStatus = totalCount > 0 && pendingCount === 0 ? 'FullySigned' : 'PartiallySigned';
    const agreementPatch = {
      partitionKey: 'AGREEMENTS',
      rowKey: agreementId,
      status: nextStatus,
      lastSignedUtc: now
    };
    if (nextStatus === 'FullySigned') agreementPatch.fullySignedUtc = now;
    await Agreements.updateEntity(agreementPatch, 'Merge');
    await logEvent(agreementId, 'SignerCompleted', {
      signerId,
      signerName,
      signerEmail: signer.Email || '',
      signedUtc: now,
      manifestBlob,
      signedPdfBlob: signedPdfBlob || null
    }).catch(() => {});

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, signerId, status: nextStatus, when: now, pendingCount, totalCount, hmac }
    };
  } catch (err) {
    context.log.error('Error en /sign', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'Error interno', detail: String(err?.message || err) }
    };
  }
};
