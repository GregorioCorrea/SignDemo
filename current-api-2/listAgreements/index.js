const { table } = require('../shared/storage');

module.exports = async function (context, req) {
  try {
    const search = ((req.query?.q || req.body?.q || '') + '').trim().toLowerCase();
    const Agreements = table('Agreements');

    // Garantiza que la tabla exista (puede ser la primera llamada, antes de crear el primer acuerdo)
    await Agreements.createTable({ onResponse: () => {} }).catch(() => {});

    const rows = [];
    for await (const entity of Agreements.listEntities()) {
      const item = {
        agreementId: entity.rowKey,
        title: entity.title || '',
        status: entity.status || '',
        createdUtc: entity.createdUtc || '',
        fullySignedUtc: entity.fullySignedUtc || null,
        approvedBy: entity.approvedBy || null,
        pdfContainer: entity.pdfContainer || null,
        pdfBlob: entity.pdfBlob || null
      };

      if (!search
        || item.agreementId.toLowerCase().includes(search)
        || item.title.toLowerCase().includes(search)
        || (item.status + '').toLowerCase().includes(search)
        || (item.approvedBy + '').toLowerCase().includes(search)) {
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
