const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { TableClient, AzureSASCredential, AzureNamedKeyCredential } = require('@azure/data-tables');

const conn = process.env.TABLES_CONNECTION;
const account = process.env.BLOB_ACCOUNT;
const accKey = /AccountKey=([^;]+)/.exec(process.env.AzureWebJobsStorage)[1];

const blobService = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
const sharedKey = new StorageSharedKeyCredential(account, accKey);

const table = (name) => TableClient.fromConnectionString(conn, name);

const containers = {
  agreements: () => blobService.getContainerClient('agreements'),
  signed:     () => blobService.getContainerClient('signed'),
  signatures: () => blobService.getContainerClient('signatures'),
  assets:     () => blobService.getContainerClient('assets'),
};

function sasForBlob(container, blobName, minutes = 15) {
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + minutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters({
    containerName: container,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    startsOn,
    expiresOn,
    protocol: SASProtocol.Https
  }, sharedKey).toString();
  return `https://${account}.blob.core.windows.net/${container}/${encodeURIComponent(blobName)}?${sas}`;
}

module.exports = { table, containers, sasForBlob };
