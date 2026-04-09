function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader("Allow", allowedMethods.join(", "));
  sendJson(res, 405, { error: "Method not allowed." });
}

module.exports = {
  sendJson,
  methodNotAllowed
};
