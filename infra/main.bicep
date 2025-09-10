param location string = resourceGroup().location
param baseName string = 'signdemo'
@description('Origen permitido para CORS en Functions (tu web). Para el demo podés usar *')
param allowOrigin string = '*'

var stgName = toLower('stg${baseName}${uniqueString(resourceGroup().id)}')
var storageSuffix = environment().suffixes.storage

// Storage Account (sin static website acá)
resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: stgName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    encryption: {
      services: {
        blob:  { enabled: true }
        file:  { enabled: true }
        table: { enabled: true }
        queue: { enabled: true }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// Blob service + versioning
resource blobsvc 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  name: 'default'
  parent: stg
  properties: {
    isVersioningEnabled: true
  }
}

// Contenedores privados
var containers = [
  'agreements'
  'signed'
  'signatures'
  'assets'
]
resource cont 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = [for c in containers: {
  name: c
  parent: blobsvc
  properties: { publicAccess: 'None' }
}]

// Tables
resource tsvc 'Microsoft.Storage/storageAccounts/tableServices@2023-01-01' = {
  name: 'default'
  parent: stg
}
var tables = [ 'Agreements', 'Signers', 'Events' ]
resource tbl 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = [for t in tables: {
  name: t
  parent: tsvc
}]

// Queue
resource qsvc 'Microsoft.Storage/storageAccounts/queueServices@2023-01-01' = {
  name: 'default'
  parent: stg
}
resource qmail 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01' = {
  name: 'mailout'
  parent: qsvc
}

// Plan Functions Linux consumo (nuevo, no pisa nada)
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${baseName}-lin'
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  kind: 'functionapp'
  properties: { reserved: true }
}

// Function App Linux (Node) SIN linuxFxVersion
resource func 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${baseName}'
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [ allowOrigin ]
        supportCredentials: false
      }
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME',    value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE',    value: '1' }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${stg.name};AccountKey=${stg.listKeys().keys[0].value};EndpointSuffix=${storageSuffix}'
        }
        {
          name: 'TABLES_CONNECTION'
          value: 'DefaultEndpointsProtocol=https;AccountName=${stg.name};AccountKey=${stg.listKeys().keys[0].value};TableEndpoint=https://${stg.name}.table.${storageSuffix}/;EndpointSuffix=${storageSuffix}'
        }
        { name: 'HMAC_SECRET',  value: 'REEMPLAZAR_LUEGO' }
        { name: 'BLOB_ACCOUNT', value: stg.name }
      ]
    }
  }
}

output storageAccountName string = stg.name
output functionAppName   string = func.name
