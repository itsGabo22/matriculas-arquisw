# Motor de Matrículas Universitarias — Proyecto Integrador de Arquitectura de Software

| Entregable | Ubicación |
|---|---|
| **1. Diseño documentado** (drivers, escenarios, estilo, contextos, tácticas, C4, ADRs, riesgos, sustentación) | [`docs/ENTREGABLE-1-Diseno-Arquitectonico.md`](docs/ENTREGABLE-1-Diseno-Arquitectonico.md) |
| **2. Walking Skeleton** (este repositorio) | `docker compose up --build` |

## Arquitectura (coherencia 1:1 con el C4 Nivel 2)

```
Estudiante / Director / Coordinador
            │ JSON/HTTP
            ▼
   api-gateway [Nginx :8080]
            │ JSON/HTTP
            ▼
   quota-service [Node/Express :3000] ──JSON/HTTP POST /validate──► validation-service [Node/Express :3001]
      │  ▲                                                          (Chain of Responsibility: prerrequisito →
      │  │ RESP Pub/Sub (expiración TTL)                             correquisito → tope de créditos → choque horario)
      ▼  │
   redis [Redis 7.4]  ◄── EVALSHA reserve_seat.lua (check-and-decrement atómico + hold con TTL 600 s)
      
   quota-service ──AMQP publish SeatReserved──► rabbitmq [exchange topic enrollment.events]
                                                   ├── cola billing.seat-reserved ──► billing-worker   (ERP simulado, reintentos, DLQ)
                                                   └── cola audit.seat-reserved   ──► audit-notification-worker (traza + alerta de aforo)
```

| Contenedor | Rol | Puerto host |
|---|---|---|
| `api-gateway` | Punto único de entrada, propaga `x-correlation-id` | 8080 |
| `quota-service` | Orquesta `/enroll`, controla cupos/aforo (Redis Lua), publica eventos | 3000 |
| `validation-service` | `POST /validate` — cadena de reglas curriculares | 3001 |
| `redis` | Contador atómico de cupos + reservas con TTL (AOF everysec) | 6379 |
| `rabbitmq` | Broker AMQP — consola: http://127.0.0.1:15672 (guest/guest) | 5672 / 15672 |
| `billing-worker` | Consumidor 1: liquidación en ERP externo (simulado, 1.5–3 s) | — |
| `audit-notification-worker` | Consumidor 2: trazabilidad y alertas de aforo | — |

## Arranque (un solo comando)

```bash
docker compose up --build
```

En otra terminal (Git Bash en Windows, o cualquier bash con `curl`):

```bash
./demo.sh            # Escenario principal: aula de 2 cupos, 3 matrículas concurrentes
./demo.sh reglas     # Rechazos de la cadena de reglas curriculares
./demo.sh estres     # ESC-1: 100 solicitudes simultáneas por el último asiento
```

### Consola de demo (opcional, apoyo visual)

Con el sistema arriba, abre **http://127.0.0.1:8080/**. Es una página estática servida por el propio `api-gateway` (no agrega ningún contenedor: siguen siendo 7). Permite crear el aula y el grupo, disparar matrículas concurrentes, ver las sillas con su TTL y ver cómo los dos consumidores procesan el evento. `./demo.sh` sigue siendo el plan principal.

Para alimentar el panel de colas, el gateway expone `GET /mq/queues` (solo lectura, solo para esta consola) hacia la API de administración de RabbitMQ. No forma parte del flujo de matrícula.

> En Windows usa `127.0.0.1` en lugar de `localhost` (este último puede resolver a IPv6 y fallar).

### Resultado esperado de `./demo.sh`

- `est-001` → **HTTP 201** `RESERVED` (`remainingSeats: 1`)
- `est-002` → **HTTP 201** `RESERVED` (`remainingSeats: 0`)
- `est-003` → **HTTP 409** `SEAT_LIMIT_REACHED` (inmediato, sin tocar RabbitMQ)
- `billing-worker` emite 2 recibos (~2 s después, consistencia eventual)
- `audit-notification-worker` registra 2 trazas y la **ALERTA AFORO: Aula LLENA**
- `./demo.sh estres` → `1 x 201` y `99 x 409`, `availableSeats: 0` (nunca negativo)

Para ver todo en vivo durante la sustentación: `docker compose logs -f quota-service billing-worker audit-notification-worker`.

## Comandos `curl` manuales

```bash
GW=http://127.0.0.1:8080

# Coordinador de Planta Física: aula con aforo físico 2
curl -s -X POST $GW/admin/rooms -H 'content-type: application/json' \
  -d '{"roomId":"AULA-301","capacity":2}'

# Director de Programa: grupo en esa aula (cupo efectivo = min(oferta + sobrecupo, aforo) = 2)
curl -s -X POST $GW/admin/sections -H 'content-type: application/json' \
  -d '{"sectionId":"ARQSW-01","roomId":"AULA-301","offeredSeats":30,"authorizedOverbooking":2}'

# 3 matrículas concurrentes
for i in 1 2 3; do
  curl -s -X POST $GW/enroll -H 'content-type: application/json' \
    -d "{\"studentId\":\"est-00$i\",\"sectionId\":\"ARQSW-01\"}" & 
done; wait

# Estado del grupo
curl -s $GW/sections/ARQSW-01
```

## Experimentos de riesgos (documento §8.1)

```bash
# E-2: ERP caído -> reintentos con backoff exponencial y DLQ, sin afectar /enroll
ERP_FAILURE_RATE=1.0 docker compose up -d billing-worker

# E-3: TTL corto para observar la liberación automática del asiento
RESERVATION_TTL_SECONDS=20 docker compose up -d quota-service
```

## Estudiantes de prueba (validation-service)

| studentId | Resultado |
|---|---|
| cualquier otro (`est-001`, …) | Elegible |
| `est-sin-prerreq` | `PREREQUISITE` (no aprobó INGSW2) |
| `est-prueba-acad` | `CREDIT_LIMIT` (promedio 2.8 → tope 12 créditos) |
| `est-choque` | `SCHEDULE_CONFLICT` (clase LUN 9–11) |

## Estructura

```
docker-compose.yml
gateway/nginx.conf
services/validation-service/src/{index,catalog}.js, rules/*.js   # Chain of Responsibility
services/quota-service/src/{index,seatStore,validationClient,eventPublisher,expiryListener}.js, *.lua
workers/billing-worker/src/{index,erpClient}.js                  # ACL del ERP
workers/audit-notification-worker/src/index.js
demo.sh
docs/ENTREGABLE-1-Diseno-Arquitectonico.md
```
