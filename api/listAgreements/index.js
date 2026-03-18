const { table } = require('../shared/storage');

module.exports = async function (context, req) {
  try {
    const search = ((req.query?.q || req.body?.q || '') + '').trim().toLowerCase();
    const Agreements = table('Agreements');
    const Signers = table('Signers');

    // Garantiza que la tabla exista (puede ser la primera llamada, antes de crear el primer acuerdo)
    await Agreements.createTable({ onResponse: () => {} }).catch(() => {});

    const rows = [];
    for await (const entity of Agreements.listEntities()) {
      let signerCount = 0;
      let signedCount = 0;
      for await (const signer of Signers.listEntities({ queryOptions: { filter: `PartitionKey eq '${entity.rowKey}'` } })) {
        signerCount += 1;
        if (String(signer.Status).toUpperCase() === 'SIGNED') signedCount += 1;
      }

      const item = {
        agreementId: entity.rowKey,
        title: entity.title || '',
        status: entity.status || '',
        createdBy: entity.createdBy || '',
        createdUtc: entity.createdUtc || '',
        approvedUtc: entity.approvedUtc || null,
        fullySignedUtc: entity.fullySignedUtc || null,
        countersignedUtc: entity.countersignedUtc || null,
        approvedBy: entity.approvedBy || null,
        pdfContainer: entity.pdfContainer || null,
        pdfBlob: entity.pdfBlob || null,
        finalPdfContainer: entity.finalPdfContainer || null,
        finalPdfBlob: entity.finalPdfBlob || null,
        signerCount,
        signedCount
      };

      if (!search
        || item.agreementId.toLowerCase().includes(search)
        || item.title.toLowerCase().includes(search)
        || (item.status + '').toLowerCase().includes(search)
        || (item.approvedBy + '').toLowerCase().includes(search)
        || (item.createdBy + '').toLowerCase().includes(search)) {
        rows.push(item);
      }
    }

    // Orden cronológico descendente
    rows.sort((a, b) => (b.createdUtc || '').localeCompare(a.createdUtc || ''));

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, count: rows.length, agreements: rows }
    };
  } catch (err) {
    context.log.error('listAgreements error', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: 'InternalError', detail: String(err?.message || err) }
    };
  }
};
