// Flecha C4: redis -.-> quota-service "Notifica expiración de reserva vía [RESP Pub/Sub]"
// Cuando un hold:{sección}:{estudiante} vence (TTL 10 min) se repone el asiento.
// Riesgo R-3 documentado: Pub/Sub no es durable; si este proceso está caído la notificación se pierde.
const Redis = require('ioredis');
const { releaseSeat } = require('./seatStore');
const log = require('./log');

function startExpiryListener() {
  const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  sub.subscribe('__keyevent@0__:expired', (err) => {
    if (err) log('No se pudo suscribir a expiraciones', { error: err.message });
    else log('Escuchando expiraciones de reservas (TTL)');
  });
  sub.on('message', async (_channel, key) => {
    if (!key.startsWith('hold:')) return;
    const [, sectionId, ...rest] = key.split(':');
    const studentId = rest.join(':');
    const available = await releaseSeat(sectionId, studentId);
    log('Reserva EXPIRADA por TTL: asiento liberado', { sectionId, studentId, availableSeats: available });
  });
}

module.exports = { startExpiryListener };
