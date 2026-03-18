function ensureWebCrypto() {
  if (globalThis.crypto) return;

  const { webcrypto } = require('node:crypto');
  if (webcrypto) {
    globalThis.crypto = webcrypto;
  }
}

module.exports = { ensureWebCrypto };
