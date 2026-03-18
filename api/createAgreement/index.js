// api/createAgreement/index.js
const { table, containers } = require('../shared/storage');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { logEvent } = require('../shared/events');
const { safeSendAgreementNotification } = require('../shared/email');

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const title = (body.title || '').trim();
    const pdfBase64 = (body.pdfBase64 || '').trim();
    const createdBy = (body.createdBy || 'system').trim();
    const notifyEmail = (body.notifyEmail || '').trim();
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
      pdfBlob = `${agreementId}/original.pdf`;
      const pdfData = Buffer.from(pdfBase64, 'base64');
      body.pdfSha256 = crypto.createHash('sha256').update(pdfData).digest('hex');
      const containerClient = containers.agreements();
      await containerClient.createIfNotExists();
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
      notifyEmail,
      pdfContainer,
      pdfBlob,
      pdfSha256: body.pdfSha256 || '',
      status: 'Created',
      createdUtc: new Date().toISOString()
    };

    await agreementsTable.upsertEntity(entity, 'Merge');
    await logEvent(agreementId, 'AgreementCreated', {
      title,
      createdBy,
      notifyEmail,
      pdfContainer,
      pdfBlob,
      pdfSha256: entity.pdfSha256
    }).catch(() => {});

    await safeSendAgreementNotification(context, agreementId, entity, {
      subject: `Acuerdo creado: ${title}`,
      heading: 'Nuevo acuerdo registrado',
      intro: 'Se creó un nuevo acuerdo en el circuito de firma.',
      items: [
        `Titulo: ${title}`,
        `AgreementId: ${agreementId}`,
        `Creado por: ${createdBy || 'N/D'}`,
        `Estado: ${entity.status}`,
        `Hash PDF: ${entity.pdfSha256 || 'No calculado'}`
      ],
      footer: 'Todavia falta cargar firmantes y aprobar el acuerdo para enviar invitaciones.'
    }, 'AgreementCreationEmailSent');

    context.res = {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        ok: true,
        agreementId,
        title,
        notifyEmail,
        pdfContainer,
        pdfBlob,
        pdfSha256: entity.pdfSha256,
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
