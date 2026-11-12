const crypto = require('crypto');
const express = require('express');
const store = require('./seatStore');
const { validate } = require('./validationClient');
const { connect, publishSeatReserved } = require('./eventPublisher');
const { startExpiryListener } = require('./expiryListener');
const log = require('./log');

const TTL = Number(process.env.RESERVATION_TTL_SECONDS || 600);
const app = express();
app.use(express.json());

// Correlation ID: viene del api-gateway o se genera aquí (táctica de trazabilidad U-8).
app.use((req, _res, next) => {
  req.correlationId = req.get('x-correlation-id') || crypto.randomUUID();
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'quota-service' }));

// ---------- Coordinador de Planta Física: registra aula y aforo legal ----------
app.post('/admin/rooms', async (req, res) => {
  const { roomId, capacity } = req.body || {};
  if (!roomId || !Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({ error: 'roomId y capacity (entero > 0) son obligatorios' });
  }
  await store.upsertRoom(roomId, capacity);
  log('Aula registrada', { correlationId: req.correlationId, roomId, capacity });
  return res.status(201).json({ roomId, capacity });
});

// ---------- Director de Programa: abre grupo en un aula (con sobrecupo autorizado) ----------
app.post('/admin/sections', async (req, res) => {
  const { sectionId, roomId, offeredSeats, authorizedOverbooking = 0 } = req.body || {};
  if (!sectionId || !roomId || !Number.isInteger(offeredSeats)) {
    return res.status(400).json({ error: 'sectionId, roomId y offeredSeats son obligatorios' });
  }
  const room = await store.getRoom(roomId);
  if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
  const section = await store.configureSection({ sectionId, room, offeredSeats, authorizedOverbooking });
  log('Grupo configurado (cupo efectivo = min(oferta + sobrecupo, aforo))', { correlationId: req.correlationId, ...section });
  return res.status(201).json(section);
});

// Reinicio de la demo: vacía el estado de cupos en Redis (no toca RabbitMQ ni los workers).
app.post('/admin/reset', async (req, res) => {
  const removed = await store.resetAll();
  log('Estado de cupos reiniciado', { correlationId: req.correlationId, keysRemoved: removed });
  return res.json({ status: 'RESET', keysRemoved: removed });
});

app.get('/sections/:id', async (req, res) => {
  const section = await store.getSection(req.params.id);
  return section ? res.json(section) : res.status(404).json({ error: 'SECTION_NOT_FOUND' });
});

// ---------- Estudiante: flujo de matrícula ----------
app.post('/enroll', async (req, res) => {
  const { correlationId } = req;
  const { studentId, sectionId } = req.body || {};
  const t0 = Date.now();
  if (!studentId || !sectionId) return res.status(400).json({ error: 'studentId y sectionId son obligatorios' });

  // 1) Validación curricular síncrona (JSON/HTTP) -> validation-service
  let validation;
  try {
    validation = await validate({ studentId, sectionId }, correlationId);
  } catch (err) {
    log('validation-service no disponible', { correlationId, error: err.message });
    return res.status(503).json({ status: 'REJECTED', reason: 'VALIDATION_UNAVAILABLE', correlationId });
  }
  if (!validation.valid) {
    log('Matrícula RECHAZADA por regla curricular', { correlationId, studentId, sectionId, failedRule: validation.failedRule });
    return res.status(422).json({
      status: 'REJECTED', reason: 'CURRICULAR_RULE_FAILED', failedRule: validation.failedRule,
      detail: validation.reason, correlationId,
    });
  }

  // 2) Reserva atómica en Redis (script Lua) con TTL
  const meta = await store.getMeta(sectionId);
  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL * 1000).toISOString();
  const result = await store.reserveSeat(sectionId, studentId, { reservationId, studentId, sectionId, expiresAt }, TTL);

  if (result === -3) return res.status(404).json({ status: 'REJECTED', reason: 'SECTION_NOT_CONFIGURED', correlationId });
  if (result === -2) {
    log('Matrícula RECHAZADA: el estudiante ya tiene reserva', { correlationId, studentId, sectionId });
    return res.status(409).json({ status: 'REJECTED', reason: 'ALREADY_RESERVED', correlationId });
  }
  if (result === -1) {
    log('Matrícula RECHAZADA: aforo físico agotado', { correlationId, studentId, sectionId, roomId: meta.roomId, ms: Date.now() - t0 });
    return res.status(409).json({
      status: 'REJECTED', reason: 'SEAT_LIMIT_REACHED', roomId: meta.roomId,
      roomCapacity: Number(meta.roomCapacity), correlationId,
    });
  }

  // 3) Publicar SeatReserved (AMQP). Si el broker falla, se compensa liberando el asiento.
  const event = {
    eventType: 'SeatReserved',
    eventVersion: 1,
    eventId: crypto.randomUUID(),
    correlationId,
    occurredAt: new Date().toISOString(),
    data: {
      reservationId, studentId, sectionId,
      roomId: meta.roomId,
      roomCapacity: Number(meta.roomCapacity),
      totalSeats: Number(meta.totalSeats),
      remainingSeats: result,
      credits: validation.credits,
      expiresAt,
    },
  };
  try {
    await publishSeatReserved(event);
  } catch (err) {
    await store.releaseSeat(sectionId, studentId, { deleteHold: true });
    log('Fallo al publicar evento: reserva COMPENSADA', { correlationId, error: err.message });
    return res.status(503).json({ status: 'REJECTED', reason: 'EVENT_BROKER_UNAVAILABLE', correlationId });
  }

  log('Cupo RESERVADO y evento SeatReserved publicado', {
    correlationId, studentId, sectionId, reservationId, remainingSeats: result, eventId: event.eventId, ms: Date.now() - t0,
  });
  return res.status(201).json({
    status: 'RESERVED', reservationId, studentId, sectionId, roomId: meta.roomId,
    remainingSeats: result, expiresAt, eventId: event.eventId, correlationId,
    billing: 'PENDING (consistencia eventual vía billing-worker)',
  });
});

async function main() {
  await connect();
  startExpiryListener();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => log(`Escuchando en :${port}`, { reservationTtlSeconds: TTL }));
}

main().catch((err) => {
  log('Error fatal de arranque', { error: err.message });
  process.exit(1);
});
