const { table, containers } = require('../shared/storage');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { logEvent } = require('../shared/events');

module.exports = async function (context, req) {
  try {
    const agreementId = String(req.body?.agreementId || req.query?.agreementId || '').trim();
    const countersignedBy = String(req.body?.countersignedBy || 'backoffice@travelcare').trim();
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
      signers.push(entity);
    }

    if (!signers.length || signers.some((signer) => String(signer.Status).toUpperCase() !== 'SIGNED')) {
      context.res = {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: false, error: 'Todavia hay firmantes pendientes' }
      };
      return;
    }

    const sourceBlob = containers.agreements().getBlockBlobClient(agreement.pdfBlob);
    const download = await sourceBlob.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    const originalPdf = Buffer.concat(chunks);

    const pdfDoc = await PDFDocument.load(originalPdf);
    const page = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let cursorY = 150;
    for (const signer of signers) {
      if (signer.SignatureBlob) {
        const sigBlob = containers.signatures().getBlockBlobClient(signer.SignatureBlob);
        const sigDownload = await sigBlob.download();
        const sigChunks = [];
        for await (const chunk of sigDownload.readableStreamBody) sigChunks.push(chunk);
        const sigPng = Buffer.concat(sigChunks);
        const png = await pdfDoc.embedPng(sigPng);
        page.drawImage(png, { x: 40, y: cursorY, width: 140, height: 44 });
      }

      page.drawText(`Firmante: ${signer.Name || signer.Email || signer.rowKey}`, { x: 200, y: cursorY + 24, size: 10, font });
      page.drawText(`Fecha: ${signer.SignedUtc || 'N/D'}`, { x: 200, y: cursorY + 12, size: 9, font });
      page.drawText(`IP: ${signer.Ip || 'N/D'}`, { x: 200, y: cursorY, size: 9, font });
      cursorY += 60;
    }

    page.drawRectangle({ x: 40, y: 40, width: Math.min(page.getWidth() - 80, 380), height: 56, color: rgb(0.96, 0.97, 1) });
    page.drawText(`Contra-firmado por: ${countersignedBy}`, { x: 52, y: 78, size: 11, font });
    page.drawText(`Fecha servidor: ${new Date().toISOString()}`, { x: 52, y: 64, size: 10, font });
    page.drawText('Estado final: CounterSigned', { x: 52, y: 50, size: 10, font });

    await containers.signed().createIfNotExists();
    const finalPdfBlob = `${agreementId}/final.pdf`;
    const finalPdf = await pdfDoc.save();
    await containers.signed().getBlockBlobClient(finalPdfBlob).uploadData(Buffer.from(finalPdf), {
      blobHTTPHeaders: { blobContentType: 'application/pdf' }
    });

    const now = new Date().toISOString();
    await Agreements.updateEntity({
      partitionKey: 'AGREEMENTS',
      rowKey: agreementId,
      status: 'CounterSigned',
      countersignedBy,
      countersignedUtc: now,
      finalPdfContainer: 'signed',
      finalPdfBlob
    }, 'Merge');

    await logEvent(agreementId, 'CounterSigned', { countersignedBy, finalPdfBlob }).catch(() => {});

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, agreementId, status: 'CounterSigned', countersignedBy, finalPdfBlob }
    };
  } catch (err) {
    context.log.error('counterSign error', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'InternalError', detail: String(err?.message || err) }
    };
  }
};
