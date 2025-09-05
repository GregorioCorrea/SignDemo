const { containers, table } = require('../shared/storage');
const { verifyToken } = require('../shared/tokens');
const { PDFDocument } = require('pdf-lib');
const crypto = require('crypto');

module.exports = async function (context, req) {
  try {
    const { token, signaturePngBase64, signatureStrokes, userAgent, consent } = req.body || {};
    if (!token || !signaturePngBase64 || !consent) return { status: 400, body: 'Datos incompletos' };

    const { agreementId, signerId, role } = verifyToken(token);
    if (role !== 'signer') return { status: 403, body: 'Rol inválido' };

    // Validar estado
    const Agreements = table('Agreements');
    const agreement = await Agreements.getEntity('agreements', agreementId);
    if (agreement.Status !== 'APPROVED') return { status: 409, body: 'No habilitado para firmar' };

    // Descargar PDF original
    const origBlob = containers.agreements().getBlockBlobClient(`${agreementId}/original.pdf`);
    const origBuf = Buffer.from(await (await origBlob.download()).readableStreamBody.toArrayBuffer());

    // Hash
    const pdfSha256 = crypto.createHash('sha256').update(origBuf).digest('hex');

    // Guardar firma (imagen+trazos)
    const sigImg = Buffer.from(signaturePngBase64, 'base64');
    await containers.signatures().getBlockBlobClient(`${agreementId}/${signerId}.png`)
      .upload(sigImg, sigImg.length, { blobHTTPHeaders: { blobContentType: 'image/png' }});
    const strokesBytes = Buffer.from(JSON.stringify(signatureStrokes ?? []));
    await containers.signatures().getBlockBlobClient(`${agreementId}/${signerId}.json`)
      .upload(strokesBytes, strokesBytes.length, { blobHTTPHeaders: { blobContentType: 'application/json' }});

    // Estampar firma en una copia temporal (cada firmante produce una versión)
    const pdfDoc = await PDFDocument.load(origBuf);
    const png = await pdfDoc.embedPng(sigImg);
    const page = pdfDoc.getPage(pdfDoc.getPageCount()-1);
    page.drawImage(png, { x: page.getWidth()-220, y: 40, width: 180, height: 60 });
    page.drawText(`Firmante: ${signerId}`, { x: 40, y: 70, size: 10 });
    page.drawText(`Cons. y UA: ${String(userAgent).slice(0,40)}...`, { x: 40, y: 55, size: 8 });
    page.drawText(`Hash: ${pdfSha256.slice(0,16)}...`, { x: 40, y: 40, size: 8 });

    const partial = await pdfDoc.save();
    await containers.agreements().getBlockBlobClient(`${agreementId}/partial/${signerId}.pdf`)
      .upload(partial, partial.length, { blobHTTPHeaders: { blobContentType: 'application/pdf' }});

    // Marcar firmante como SIGNED
    const Signers = table('Signers');
    const signer = await Signers.getEntity(agreementId, signerId);
    signer.Status = 'SIGNED';
    signer.SignedAtUtc = new Date().toISOString();
    signer.UserAgent = userAgent ?? '';
    await Signers.updateEntity(signer, 'Merge');

    // Si todos firmaron, pasamos a READY_FOR_COUNTERSIGN
    const signedAll = (await Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } }))
      .byPage({ maxPageSize: 1000 });
    let allSigned = true;
    for await (const page of signedAll) {
      for (const e of page) { if (e.Status !== 'SIGNED') allSigned = false; }
    }
    if (allSigned) {
      agreement.Status = 'READY_FOR_COUNTERSIGN';
      await Agreements.updateEntity(agreement, 'Merge');
    }

    // Evidencia simple (HMAC del manifiesto del firmante)
    const manifest = {
      agreementId, signerId, consent: !!consent, pdfSha256,
      timestampUtc: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent
    };
    const hmac = crypto.createHmac('sha256', process.env.HMAC_SECRET).update(JSON.stringify(manifest)).digest('hex');
    await containers.agreements().getBlockBlobClient(`${agreementId}/manifests/${signerId}.json`)
      .upload(Buffer.from(JSON.stringify({ ...manifest, hmac })), undefined, { blobHTTPHeaders: { blobContentType: 'application/json' }});

    return { status: 200, jsonBody: { status: 'SIGNED', hmac } };
  } catch (e) {
    context.log.error(e);
    return { status: 500, body: e.message };
  }
}
