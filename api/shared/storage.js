function getStorageBlobSdk() {
  return require('@azure/storage-blob');
}

function getTablesSdk() {
  return require('@azure/data-tables');
}

function getTablesConnection() {
  const conn = process.env.TABLES_CONNECTION;
  if (!conn) throw new Error('Missing TABLES_CONNECTION');
  return conn;
}

function getBlobAccount() {
  const account = process.env.BLOB_ACCOUNT;
  if (!account) throw new Error('Missing BLOB_ACCOUNT');
  return account;
}

function getStorageConnection() {
  const conn = process.env.AzureWebJobsStorage;
  if (!conn) throw new Error('Missing AzureWebJobsStorage');
  return conn;
}

function getStorageAccountKey() {
  const match = /AccountKey=([^;]+)/i.exec(getStorageConnection());
  if (!match || !match[1]) {
    throw new Error('AzureWebJobsStorage does not contain AccountKey');
  }
  return match[1];
}

function getBlobService() {
  const { BlobServiceClient } = getStorageBlobSdk();
  return BlobServiceClient.fromConnectionString(getStorageConnection());
}

function getSharedKey() {
  const { StorageSharedKeyCredential } = getStorageBlobSdk();
  return new StorageSharedKeyCredential(getBlobAccount(), getStorageAccountKey());
}

function table(name) {
  const { TableClient } = getTablesSdk();
  return TableClient.fromConnectionString(getTablesConnection(), name);
}

const containers = {
  agreements: () => getBlobService().getContainerClient('agreements'),
  signed: () => getBlobService().getContainerClient('signed'),
  signatures: () => getBlobService().getContainerClient('signatures'),
  assets: () => getBlobService().getContainerClient('assets'),
};

function sasForBlob(container, blobName, minutes = 15) {
  const {
    generateBlobSASQueryParameters,
    BlobSASPermissions,
    SASProtocol
  } = getStorageBlobSdk();

  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + minutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters({
    containerName: container,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    startsOn,
    expiresOn,
    protocol: SASProtocol.Https
  }, getSharedKey()).toString();

  return `https://${getBlobAccount()}.blob.core.windows.net/${container}/${encodeURIComponent(blobName)}?${sas}`;
}

module.exports = { table, containers, sasForBlob };
