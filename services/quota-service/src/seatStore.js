// Adaptador de Redis: único dueño del estado de cupos y aforos (contexto C2).
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.defineCommand('reserveSeat', {
  numberOfKeys: 2,
  lua: fs.readFileSync(path.join(__dirname, 'reserve_seat.lua'), 'utf8'),
});
redis.defineCommand('releaseSeat', {
  numberOfKeys: 2,
  lua: fs.readFileSync(path.join(__dirname, 'release_seat.lua'), 'utf8'),
});

const keys = {
  room: (roomId) => `room:${roomId}`,
  seats: (sectionId) => `section:${sectionId}:seats`,
  meta: (sectionId) => `section:${sectionId}:meta`,
  hold: (sectionId, studentId) => `hold:${sectionId}:${studentId}`,
};

async function scanKeys(pattern) {
  const found = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

// Borra aulas, grupos, contadores y reservas. Solo para reiniciar pruebas de la demo.
async function resetAll() {
  const found = [];
  for (const pattern of ['room:*', 'section:*', 'hold:*']) found.push(...(await scanKeys(pattern)));
  if (found.length) await redis.del(...found);
  return found.length;
}

async function upsertRoom(roomId, capacity) {
  await redis.hset(keys.room(roomId), { roomId, capacity });
}

async function getRoom(roomId) {
  const room = await redis.hgetall(keys.room(roomId));
  return room.roomId ? { roomId: room.roomId, capacity: Number(room.capacity) } : null;
}

// El cupo efectivo nunca supera el aforo físico del aula (restricción C-2).
async function configureSection({ sectionId, room, offeredSeats, authorizedOverbooking }) {
  const totalSeats = Math.min(offeredSeats + authorizedOverbooking, room.capacity);
  const holds = await scanKeys(`hold:${sectionId}:*`);
  const tx = redis.multi();
  if (holds.length) tx.del(...holds);
  tx.hset(keys.meta(sectionId), {
    sectionId, roomId: room.roomId, roomCapacity: room.capacity, offeredSeats, authorizedOverbooking, totalSeats,
  });
  tx.set(keys.seats(sectionId), totalSeats);
  await tx.exec();
  return { sectionId, roomId: room.roomId, roomCapacity: room.capacity, offeredSeats, authorizedOverbooking, totalSeats };
}

async function getSection(sectionId) {
  const meta = await redis.hgetall(keys.meta(sectionId));
  if (!meta.sectionId) return null;
  const available = Number(await redis.get(keys.seats(sectionId)));
  const holdKeys = await scanKeys(`hold:${sectionId}:*`);
  return {
    sectionId,
    roomId: meta.roomId,
    roomCapacity: Number(meta.roomCapacity),
    totalSeats: Number(meta.totalSeats),
    availableSeats: available,
    activeReservations: holdKeys.map((k) => k.split(':').slice(2).join(':')),
  };
}

async function reserveSeat(sectionId, studentId, reservation, ttlSeconds) {
  return redis.reserveSeat(
    keys.seats(sectionId), keys.hold(sectionId, studentId), JSON.stringify(reservation), ttlSeconds,
  );
}

async function getMeta(sectionId) {
  return redis.hgetall(keys.meta(sectionId));
}

// Compensación (si falla la publicación del evento) o expiración del TTL.
async function releaseSeat(sectionId, studentId, { deleteHold = false } = {}) {
  if (deleteHold) await redis.del(keys.hold(sectionId, studentId));
  return redis.releaseSeat(keys.seats(sectionId), keys.meta(sectionId));
}

module.exports = {
  redis, resetAll, upsertRoom, getRoom, configureSection, getSection, getMeta, reserveSeat, releaseSeat,
};
