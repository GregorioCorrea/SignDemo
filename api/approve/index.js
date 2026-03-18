const { table } = require('../shared/storage');
const { logEvent } = require('../shared/events');
const { sendEmail, safeSendAgreementNotification } = require('../shared/email');

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

    let signerCount = 0;
    const signers = [];
    for await (const signer of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
      signerCount += 1;
      signers.push(signer);
    }

    if (signerCount === 0) {
      context.res = {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'No se puede aprobar un acuerdo sin firmantes' }
      };
      return;
    }

    const approvedUtc = new Date().toISOString();
    await Agreements.upsertEntity({
      partitionKey: 'AGREEMENTS',
      rowKey: agreementId,
      status: 'Approved',
      approvedBy,
      approvedUtc
    }, 'Merge');
    await logEvent(agreementId, 'AgreementApproved', { approvedBy }).catch(() => {});

    const emailResults = [];
    for (const signer of signers) {
      const signerEmail = String(signer.Email || '').trim();
      const signUrl = String(signer.SignUrl || '').trim();
      if (!signerEmail || !signUrl) continue;

      try {
        const result = await sendEmail({
          to: signerEmail,
          subject: `Firma pendiente: ${agreement.title || agreementId}`,
          text: [
            `Hola ${signer.Name || signerEmail},`,
            '',
            `Tenes un documento pendiente de firma: ${agreement.title || agreementId}.`,
            `Link de firma: ${signUrl}`,
            '',
            'Este enlace fue generado por eSign Demo.'
          ].join('\n'),
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1e293b">
              <h2 style="margin:0 0 12px;color:#e60045">Documento pendiente de firma</h2>
              <p>Hola ${signer.Name || signerEmail},</p>
              <p>Tenes un documento pendiente de firma: <strong>${agreement.title || agreementId}</strong>.</p>
              <p><a href="${signUrl}" style="color:#e60045;font-weight:700">Abrir enlace de firma</a></p>
              <p>Si no esperabas este correo, ignoralo.</p>
            </div>
          `
        });
        emailResults.push({ email: signerEmail, status: result.status || 'Succeeded' });
      } catch (err) {
        emailResults.push({ email: signerEmail, status: 'Failed', error: String(err?.message || err) });
        context.log.warn(`No se pudo enviar invitacion a ${signerEmail}: ${err.message || err}`);
      }
    }

    await logEvent(agreementId, 'SignerInvitationsProcessed', {
      approvedBy,
      results: emailResults
    }).catch(() => {});

    await safeSendAgreementNotification(context, agreementId, agreement, {
      subject: `Acuerdo aprobado: ${agreement.title || agreementId}`,
      heading: 'Acuerdo aprobado',
      intro: 'El acuerdo fue aprobado y se procesaron las invitaciones para los firmantes.',
      items: [
        `AgreementId: ${agreementId}`,
        `Titulo: ${agreement.title || 'Sin titulo'}`,
        `Aprobado por: ${approvedBy}`,
        `Firmantes: ${signerCount}`,
        `Invitaciones procesadas: ${emailResults.length}`
      ]
    }, 'AgreementApprovalEmailSent');

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, status: 'Approved', approvedBy, approvedUtc, invitations: emailResults }
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
