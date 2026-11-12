// Flecha C4: quota-service -.-> rabbitmq "Publica evento SeatReserved vía [AMQP]"
// Táctica T-2 (Queue-Based Load Leveling): el productor nunca espera al ERP, solo al broker.
const amqp = require('amqplib');
const log = require('./log');

const EXCHANGE = 'enrollment.events';
const ROUTING_KEY = 'enrollment.seat.reserved';
let channel;

async function connect(retries = 30) {
  for (let i = 1; i <= retries; i += 1) {
    try {
      const conn = await amqp.connect(process.env.AMQP_URL || 'amqp://localhost');
      conn.on('close', () => { log('Conexión AMQP cerrada, saliendo para reinicio'); process.exit(1); });
      channel = await conn.createConfirmChannel(); // confirmaciones del broker = publicación durable
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      log('Conectado a RabbitMQ', { exchange: EXCHANGE });
      return;
    } catch (err) {
      log('RabbitMQ no disponible, reintentando', { attempt: i, error: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('No fue posible conectar con RabbitMQ');
}

function publishSeatReserved(event) {
  return new Promise((resolve, reject) => {
    channel.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        correlationId: event.correlationId,
        type: event.eventType,
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

module.exports = { connect, publishSeatReserved, EXCHANGE, ROUTING_KEY };
