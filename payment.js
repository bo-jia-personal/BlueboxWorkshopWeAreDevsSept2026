const http = require('node:http');
const { randomUUID } = require('node:crypto');
const port = Number(process.env.PORT || 4004);
const transactionsByOrder = new Map();

/** Sends a JSON response with the requested HTTP status.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @param {number} status HTTP status code.
 * @param {object} body Response data.
 * @returns {void}
 */
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Validates a charge and creates an idempotency-aware payment response.
 * @param {string} body Raw JSON request body.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @returns {NodeJS.Timeout|void} Response timer, or void for validation errors.
 */
const processChargeBody = (body, res) => {
  const input = JSON.parse(body || '{}');
  if (!input.amountCents)
    return send(res, 400, { error: 'Amount is required' });

  const transactionId = `txn_${randomUUID().slice(0, 8)}`;
  const previousTransactionId = transactionsByOrder.get(input.orderId);
  transactionsByOrder.set(input.orderId, transactionId);
  const log = {
    event: 'payment_transaction_created',
    orderId: input.orderId,
    transactionId,
    attempt: input.attempt,
    amountCents: input.amountCents,
  };
  if (previousTransactionId) log.duplicateOf = previousTransactionId;
  console.log(JSON.stringify(log));

  const response = { status: 'approved', transactionId };
  if (previousTransactionId) response.duplicateOf = previousTransactionId;
  const delay = input.attempt === 1 ? 500 : 0;
  return setTimeout(() => send(res, 200, response), delay);
};

/** Reads the request body for one charge and processes it when complete.
 * @param {import('node:http').IncomingMessage} req Incoming charge request.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @returns {void}
 */
const handleChargeRequest = (req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => processChargeBody(body, res));
};

/** Routes health checks and charge requests to the appropriate response.
 * @param {import('node:http').IncomingMessage} req Incoming request.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @returns {void}
 */
const handleRequest = (req, res) => {
  if (req.url === '/health')
    return send(res, 200, { status: 'ok', service: 'payment' });
  if (req.method !== 'POST' || req.url !== '/charge')
    return send(res, 404, { error: 'Not found' });
  return handleChargeRequest(req, res);
};

/** Logs the payment service address after the HTTP server starts listening.
 * @returns {void}
 */
const onServerListening = () =>
  console.log(`payment service running at http://localhost:${port}`);

http.createServer(handleRequest).listen(port, onServerListening);
