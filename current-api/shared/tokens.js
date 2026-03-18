// shared/tokens.js
const jwt = require('jsonwebtoken');

const SECRET = process.env.HMAC_SECRET || 'dev-hmac-secret';

// Crea un JWT con expiración en minutos
function issueToken(payload, minutes = 60) {
  return jwt.sign(payload, SECRET, {
    algorithm: 'HS256',
    expiresIn: `${minutes}m`
  });
}

// Valida y devuelve el payload
function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

module.exports = { issueToken, verifyToken };