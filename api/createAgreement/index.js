// api/createAgreement/index.js
const { TableClient, AzureSASCredential, AzureNamedKeyCredential } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const { agreementId, title, pdfContainer, pdfBlob } = body;

    if (!agreementId || !pdfContainer || !pdfBlob) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "Faltan campos obligatorios: agreementId, pdfContainer, pdfBlob" }
      };
      return;
    }

    // Conexión a Tables: preferimos TABLES_CONNECTION (connection string)
    const tablesConn = process.env.TABLES_CONNECTION;
    if (!tablesConn) {
      context.res = { status: 500, body: { error: "TABLES_CONNECTION no configurado" } };
      return;
    }

    // Crear cliente a partir del connection string
    // TableClient.fromConnectionString(connectionString, tableName)
    const tableName = "Agreements";
    const tableClient = TableClient.fromConnectionString(tablesConn, tableName);

    // Nos aseguramos que la tabla exista
    await tableClient.createTable({ onResponse: () => {} }).catch(() => { /* ya existe */ });

    // Entidad (PartitionKey y RowKey son obligatorios)
    const entity = {
      partitionKey: "AGREEMENTS",
      rowKey: agreementId,
      title: title || "",
      pdfContainer,
      pdfBlob,
      status: "Created",
      createdUtc: new Date().toISOString()
    };

    // Upsert (replace) para que sea idempotente en demos
    await tableClient.upsertEntity(entity, "Replace");

    context.res = {
      status: 201,
      headers: { "Content-Type": "application/json" },
      body: {
        ok: true,
        agreementId,
        title: entity.title,
        pdf: { container: pdfContainer, blob: pdfBlob },
        status: entity.status,
        createdUtc: entity.createdUtc
      }
    };
  } catch (err) {
    context.log.error("createAgreement error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: "InternalError", detail: String(err && err.message || err) }
    };
  }
};
