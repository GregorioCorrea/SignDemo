const { table } = require('./storage');

async function logEvent(agreementId, type, payload = {}) {
  const Events = table('Events');
  await Events.createTable({ onResponse: () => {} }).catch(() => {});

  const rowKey = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  await Events.upsertEntity({
    partitionKey: agreementId,
    rowKey,
    type,
    payloadJson: JSON.stringify(payload),
    createdUtc: new Date().toISOString()
  }, 'Merge');
}

async function listEvents(agreementId) {
  const Events = table('Events');
  const rows = [];
  for await (const entity of Events.listEntities({ queryOptions: { filter: `PartitionKey eq '${agreementId}'` } })) {
    let payload = {};
    try {
      payload = entity.payloadJson ? JSON.parse(entity.payloadJson) : {};
    } catch (err) {
      payload = { raw: entity.payloadJson || null };
    }

    rows.push({
      type: entity.type || 'Unknown',
      createdUtc: entity.createdUtc || null,
      payload
    });
  }

  rows.sort((a, b) => String(b.createdUtc || '').localeCompare(String(a.createdUtc || '')));
  return rows;
}

module.exports = { logEvent, listEvents };
