// Consumidor 2: audit-notification-worker (proceso separado, cola propia).
// Flecha C4: rabbitmq -.-> audit-notification-worker "Entrega SeatReserved desde cola audit.seat-reserved vía [AMQP]"
// Recibe el MISMO evento que billing-worker (fan-out por exchange topic), sin que el productor lo sepa.
const amqp = require('amqplib');

const EXCHANGE = 'enrollment.events';
const QUEUE = 'audit.seat-reserved';
const ROUTING_KEY = 'enrollment.seat.*';
const THRESHOLD = Number(process.env.OCCUPANCY_ALERT_THRESHOLD || 0.8);

const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'audit-notification-worker', msg, ...extra }));
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

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await ch.prefetch(20);
  log('Esperando eventos de matrícula', { queue: QUEUE, bindingKey: ROUTING_KEY });

  await ch.consume(QUEUE, (msg) => {
    const event = JSON.parse(msg.content.toString());
    const { data, correlationId, eventId, occurredAt } = event;
    const occupied = data.totalSeats - data.remainingSeats;
    const occupancy = occupied / data.roomCapacity;

    log('[AUDITORÍA] Traza de matrícula registrada', {
      correlationId, eventId, eventType: event.eventType, occurredAt,
      studentId: data.studentId, sectionId: data.sectionId, roomId: data.roomId,
      occupancy: `${occupied}/${data.roomCapacity} (${Math.round(occupancy * 100)}%)`,
    });

    if (data.remainingSeats === 0) {
      log('[ALERTA AFORO] Aula LLENA: aforo físico alcanzado, nuevas solicitudes serán rechazadas', {
        correlationId, roomId: data.roomId, sectionId: data.sectionId, roomCapacity: data.roomCapacity,
        notify: 'Coordinador de Planta Física',
      });
    } else if (occupancy >= THRESHOLD) {
      log('[ALERTA AFORO] Ocupación sobre el umbral', {
        correlationId, roomId: data.roomId, occupancyPct: Math.round(occupancy * 100), thresholdPct: THRESHOLD * 100,
        notify: 'Coordinador de Planta Física',
      });
    }
    ch.ack(msg);
  });
}

main().catch((err) => {
  log('Error fatal', { error: err.message });
  process.exit(1);
});
