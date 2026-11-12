-- Táctica T-1 / ADR-002: check-and-decrement atómico.
-- Redis ejecuta el script completo sin intercalar otros comandos => imposible la condición de carrera.
-- KEYS[1] = section:{id}:seats     (contador de asientos disponibles)
-- KEYS[2] = hold:{id}:{studentId}  (reserva temporal del estudiante)
-- ARGV[1] = payload de la reserva (JSON)
-- ARGV[2] = TTL en segundos (600 = 10 minutos)
-- Retorno: >= 0 asientos restantes | -1 sin cupo | -2 ya tiene reserva | -3 grupo inexistente

local seats = redis.call('GET', KEYS[1])
if not seats then
  return -3
end
seats = tonumber(seats)

if redis.call('EXISTS', KEYS[2]) == 1 then
  return -2
end

if seats <= 0 then
  return -1
end

redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
return seats - 1
