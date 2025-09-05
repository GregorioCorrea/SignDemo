const jwt = require('jsonwebtoken');
const HMAC_SECRET = process.env.HMAC_SECRET;

function issueToken(payload, minutes = 60) {
  return jwt.sign(payload, HMAC_SECRET, { expiresIn: `${minutes}m` });
}

function verifyToken(token) {
  return jwt.verify(token, HMAC_SECRET);
}

module.exports = { issueToken, verifyToken };
