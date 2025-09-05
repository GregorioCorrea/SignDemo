const { containers, table } = require('../shared/storage');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
  try {
    const { title, pdfBase64, createdBy } = req.body || {};
    if (!pdfBase64) return { status: 400, body: 'Falta pdfBase64' };

    const agreementId = uuidv4();
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    const blob = containers.agreements().getBlockBlobClient(`${agreementId}/original.pdf`);
    await blob.upload(pdfBuffer, pdfBuffer.length, { blobHTTPHeaders: { blobContentType: 'application/pdf' }});

    const Agreements = table('Agreements');
    await Agreements.createEntity({
      partitionKey: 'agreements',
      rowKey: agreementId,
      Title: title ?? `Agreement ${agreementId}`,
      PdfSha256: hash,
      Status: 'DRAFT',
      CreatedBy: createdBy ?? 'admin@demo',
      CreatedAtUtc: new Date().toISOString()
    });

    return { status: 200, jsonBody: { agreementId, pdfSha256: hash } };
  } catch (e) {
    context.log.error(e);
    return { status: 500, body: e.message };
  }
}
