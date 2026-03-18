// api/createAgreement/index.js
const { table, containers } = require('../shared/storage');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const title = (body.title || '').trim();
    const pdfBase64 = (body.pdfBase64 || '').trim();
    const createdBy = (body.createdBy || 'system').trim();
    let agreementId = (body.agreementId || '').trim();

    if (!title) {
      context.res = { status: 400, body: { error: 'Falta título (title)' } };
      return;
    }

    if (!agreementId) agreementId = uuidv4();

    const agreementsTable = table('Agreements');
    await agreementsTable.createTable({ onResponse: () => {} }).catch(() => {});

    let pdfContainer = body.pdfContainer;
    let pdfBlob = body.pdfBlob;

    if (pdfBase64) {
      pdfContainer = 'agreements';
      pdfBlob = `${agreementId}.pdf`;
      const pdfData = Buffer.from(pdfBase64, 'base64');
      const containerClient = containers.agreements();
      await containerClient.createIfNotExists({ access: 'container' });
      const blockClient = containerClient.getBlockBlobClient(pdfBlob);
      await blockClient.uploadData(pdfData, {
        blobHTTPHeaders: { blobContentType: 'application/pdf' }
      });
    }

    if (!pdfContainer || !pdfBlob) {
      context.res = { status: 400, body: { error: 'Faltan pdfContainer o pdfBlob' } };
      return;
    }

    const entity = {
      partitionKey: 'AGREEMENTS',
      rowKey: agreementId,
      title,
      createdBy,
      pdfContainer,
      pdfBlob,
      status: 'Created',
      createdUtc: new Date().toISOString()
    };

    await agreementsTable.upsertEntity(entity, 'Merge');

    context.res = {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        ok: true,
        agreementId,
        title,
        pdfContainer,
        pdfBlob,
        status: entity.status,
        createdUtc: entity.createdUtc
      }
    };
  } catch (err) {
    context.log.error('createAgreement error:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'InternalError', detail: String(err?.message || err) }
    };
  }
};
