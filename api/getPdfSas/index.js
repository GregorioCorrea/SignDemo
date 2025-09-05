const { sasForBlob } = require('../shared/storage');
const { verifyToken } = require('../shared/tokens');

module.exports = async function (context, req) {
  try {
    const { token } = req.query;
    const { agreementId } = verifyToken(token);
    const url = sasForBlob('agreements', `${agreementId}/original.pdf`, 15);
    return { status: 200, jsonBody: { url } };
  } catch {
    return { status: 401, body: 'Token inválido' };
  }
}
