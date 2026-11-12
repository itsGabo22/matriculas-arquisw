-- Reposición de un asiento cuando una reserva expira (TTL) o se compensa.
-- Nunca supera el total configurado del grupo (protege el invariante inscritos <= aforo).
-- KEYS[1] = section:{id}:seats
-- KEYS[2] = section:{id}:meta (hash con totalSeats)
local seats = redis.call('GET', KEYS[1])
if not seats then
  return -3
end
local total = tonumber(redis.call('HGET', KEYS[2], 'totalSeats') or '0')
if tonumber(seats) >= total then
  return tonumber(seats)
end
return redis.call('INCR', KEYS[1])
