// Consumidor 1: billing-worker (proceso separado).
// Flecha C4: rabbitmq -.-> billing-worker "Entrega SeatReserved desde cola billing.seat-reserved vía [AMQP]"
// Táctica T-2 (Queue-Based Load Leveling): prefetch limitado = ritmo que tolera el ERP.
const amqp = require('amqplib');
const { checkClearanceAndIssueReceipt } = require('./erpClient');

const EXCHANGE = 'enrollment.events';
const QUEUE = 'billing.seat-reserved';
const DLQ = 'billing.dlq';
const ROUTING_KEY = 'enrollment.seat.reserved';
const PREFETCH = Number(process.env.PREFETCH || 2);
const MAX_ATTEMPTS = 5;

const processed = new Set(); // idempotencia por eventId (entrega at-least-once)
const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'billing-worker', msg, ...extra }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 1; i <= 30; i += 1) {
    try {
      return await amqp.connect(process.env.AMQP_URL || 'amqp://localhost');
    } catch (err) {
      log('RabbitMQ no disponible, reintentando', { attempt: i, error: err.message });
      await sleep(2000);
    }
  }
  throw new Error('No fue posible conectar con RabbitMQ');
}

async function main() {
  const conn = await connect();
  conn.on('close', () => process.exit(1));
  const ch = await conn.createChannel();

  // El consumidor es dueño de su cola (topología declarativa e idempotente).
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await ch.prefetch(PREFETCH);
  log('Esperando eventos SeatReserved', { queue: QUEUE, prefetch: PREFETCH });

  await ch.consume(QUEUE, async (msg) => {
    const event = JSON.parse(msg.content.toString());
    const attempt = Number(msg.properties.headers?.['x-attempt'] || 1);
    const { correlationId, eventId, data } = event;

    if (processed.has(eventId)) {
      log('Evento duplicado ignorado (idempotencia)', { correlationId, eventId });
      return ch.ack(msg);
    }

    log('[ERP] Solicitando paz y salvo y emisión de recibo...', {
      correlationId, eventId, studentId: data.studentId, sectionId: data.sectionId, attempt,
    });
    try {
      const receipt = await checkClearanceAndIssueReceipt(data);
      processed.add(eventId);
      log('[ERP] RECIBO EMITIDO', {
        correlationId, reservationId: data.reservationId, studentId: data.studentId,
        receiptNumber: receipt.receiptNumber, amount: receipt.amount, currency: receipt.currency,
        erpLatencyMs: receipt.latency,
      });
      ch.ack(msg);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        ch.sendToQueue(DLQ, msg.content, { persistent: true, headers: { 'x-attempt': attempt, 'x-error': err.message } });
        log('[ERP] Reintentos agotados -> enviado a DLQ', { correlationId, eventId, attempt });
      } else {
        const backoff = 1000 * 2 ** (attempt - 1);
        log('[ERP] Fallo, se reprograma con backoff exponencial', { correlationId, eventId, attempt, backoffMs: backoff, error: err.message });
        await sleep(backoff);
        ch.sendToQueue(QUEUE, msg.content, { ...msg.properties, persistent: true, headers: { 'x-attempt': attempt + 1 } });
      }
      ch.ack(msg);
    }
    return undefined;
  });
}

main().catch((err) => {
  log('Error fatal', { error: err.message });
  process.exit(1);
});
