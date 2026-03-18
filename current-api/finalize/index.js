module.exports = async function (context) {
  context.res = {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
    body: { ok: false, error: 'DeprecatedEndpoint', detail: 'Usar /api/sign para completar la firma.' }
  };
};
