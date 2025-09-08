// api/getPdfSas/index.js
const { BlobSASPermissions, generateBlobSASQueryParameters } = require("@azure/storage-blob");
const { StorageSharedKeyCredential } = require("@azure/storage-blob");

module.exports = async function (context, req) {
  try {
    const container = (req.query.container || req.body?.container || "").trim();
    const blob = (req.query.blob || req.body?.blob || "").trim();

    if (!container || !blob) {
      context.res = { status: 400, body: { error: "Faltan 'container' y/o 'blob'." } };
      return;
    }

    const accountName = process.env.BLOB_ACCOUNT;
    const conn = process.env.AzureWebJobsStorage;
    if (!accountName || !conn) {
      context.res = { status: 500, body: { error: "Faltan variables BLOB_ACCOUNT o AzureWebJobsStorage" } };
      return;
    }

    // Extraemos AccountKey del connection string
    // Ej: DefaultEndpointsProtocol=...;AccountName=xxx;AccountKey=YYY;EndpointSuffix=core.windows.net
    const accountKeyMatch = conn.match(/AccountKey=([^;]+)/i);
    if (!accountKeyMatch) {
      context.res = { status: 500, body: { error: "No se pudo obtener AccountKey del AzureWebJobsStorage" } };
      return;
    }
    const accountKey = accountKeyMatch[1];

    const sharedKey = new StorageSharedKeyCredential(accountName, accountKey);

    // SAS de lectura por 60 minutos
    const start = new Date();
    const expiry = new Date(start.getTime() + 60 * 60 * 1000);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: container,
        blobName: blob,
        permissions: BlobSASPermissions.parse("r"), // solo lectura
        startsOn: start,
        expiresOn: expiry,
        protocol: "https"
      },
      sharedKey
    ).toString();

    const url = `https://${accountName}.blob.core.windows.net/${container}/${encodeURIComponent(blob)}?${sas}`;

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, url, expiresOn: expiry.toISOString() }
    };
  } catch (err) {
    context.log.error("getPdfSas error:", err);
    context.res = { status: 500, body: { error: "InternalError", detail: String(err?.message || err) } };
  }
};