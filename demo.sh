#!/usr/bin/env bash
# Demo en vivo del Walking Skeleton — Motor de Matrículas
#   ./demo.sh           -> escenario principal: aula de 2 cupos, 3 matrículas CONCURRENTES
#   ./demo.sh reglas    -> rechazos por la cadena de reglas curriculares (Chain of Responsibility)
#   ./demo.sh estres    -> ESC-1: 100 solicitudes simultáneas por el ÚLTIMO asiento
# Requisitos: bash (Git Bash en Windows), curl y docker compose. Antes: docker compose up --build -d

set -u
GW="${GW:-http://127.0.0.1:8080}"
MQ_API="http://guest:guest@127.0.0.1:15672/api"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
post() { curl -s -X POST "$GW$1" -H 'content-type: application/json' ${3:+-H "x-correlation-id: $3"} -d "$2"; echo; }

wait_ready() {
  bold "Esperando a que el sistema esté listo (gateway + 2 consumidores conectados)"
  for _ in $(seq 1 60); do
    if curl -sf "$GW/gateway/health" >/dev/null && curl -sf "$GW/health" >/dev/null \
      && curl -s "$MQ_API/queues/%2F/billing.seat-reserved" | grep -q '"consumers":[1-9]' \
      && curl -s "$MQ_API/queues/%2F/audit.seat-reserved" | grep -q '"consumers":[1-9]'; then
      echo "Sistema listo."; return 0
    fi
    sleep 2
  done
  echo "El sistema no respondió a tiempo. ¿Ejecutaste 'docker compose up --build -d'?"; exit 1
}

setup_section() { # $1 = aforo del aula
  bold "Coordinador de Planta Física registra AULA-301 con aforo físico = $1"
  post /admin/rooms "{\"roomId\":\"AULA-301\",\"capacity\":$1}"
  bold "Director de Programa abre ARQSW-01 en AULA-301 (oferta 30 + sobrecupo 2 -> limitado por aforo)"
  post /admin/sections '{"sectionId":"ARQSW-01","roomId":"AULA-301","offeredSeats":30,"authorizedOverbooking":2}'
}

main_demo() {
  wait_ready
  setup_section 2

  bold "Disparando 3 matrículas CONCURRENTES (est-001, est-002, est-003) contra 2 asientos"
  for i in 1 2 3; do
    curl -s -o "$TMP/r$i.json" -w '%{http_code}' -X POST "$GW/enroll" \
      -H 'content-type: application/json' -H "x-correlation-id: demo-est-00$i" \
      -d "{\"studentId\":\"est-00$i\",\"sectionId\":\"ARQSW-01\"}" > "$TMP/c$i" &
  done
  wait
  for i in 1 2 3; do
    printf '\n  est-00%s -> HTTP %s\n  %s\n' "$i" "$(cat "$TMP/c$i")" "$(cat "$TMP/r$i.json")"
  done

  bold "Estado del grupo en Redis (asientos disponibles y reservas activas con TTL)"
  curl -s "$GW/sections/ARQSW-01"; echo

  bold "Esperando ~4 s a que el ERP simulado (lento) emita los recibos..."
  sleep 4

  bold "Logs: quota-service (reserva atómica + publicación AMQP)"
  docker compose logs --no-log-prefix --since 30s quota-service | grep -E 'demo-est' || true
  bold "Logs: validation-service (cadena de reglas)"
  docker compose logs --no-log-prefix --since 30s validation-service | grep -E 'demo-est' || true
  bold "Logs: CONSUMIDOR 1 billing-worker (liquidación en ERP)"
  docker compose logs --no-log-prefix --since 30s billing-worker | grep -E 'demo-est' || true
  bold "Logs: CONSUMIDOR 2 audit-notification-worker (trazabilidad y alerta de aforo)"
  docker compose logs --no-log-prefix --since 30s audit-notification-worker | grep -E 'demo-est' || true

  bold "Resultado esperado: 2 x HTTP 201 RESERVED, 1 x HTTP 409 SEAT_LIMIT_REACHED, 2 eventos en cada consumidor"
}

rules_demo() {
  wait_ready
  setup_section 40
  bold "est-sin-prerreq (no aprobó INGSW2) -> PREREQUISITE"
  post /enroll '{"studentId":"est-sin-prerreq","sectionId":"ARQSW-01"}'
  bold "est-prueba-acad (promedio 2.8, tope 12 créditos) -> CREDIT_LIMIT"
  post /enroll '{"studentId":"est-prueba-acad","sectionId":"ARQSW-01"}'
  bold "est-choque (tiene clase LUN 9-11) -> SCHEDULE_CONFLICT"
  post /enroll '{"studentId":"est-choque","sectionId":"ARQSW-01"}'
  bold "est-100 (regular) -> RESERVED; segundo intento -> ALREADY_RESERVED"
  post /enroll '{"studentId":"est-100","sectionId":"ARQSW-01"}'
  post /enroll '{"studentId":"est-100","sectionId":"ARQSW-01"}'
}

stress_demo() {
  wait_ready
  setup_section 1
  bold "ESC-1: 100 solicitudes simultáneas por el ÚLTIMO asiento"
  for i in $(seq 1 100); do
    curl -s -o /dev/null -w '%{http_code}\n' -X POST "$GW/enroll" -H 'content-type: application/json' \
      -d "{\"studentId\":\"stress-$i\",\"sectionId\":\"ARQSW-01\"}" > "$TMP/code-$i" &
  done
  wait
  bold "Distribución de respuestas (esperado: 1 x 201 y 99 x 409)"
  cat "$TMP"/code-* | sort | uniq -c
  bold "Estado final (availableSeats debe ser 0, nunca negativo)"
  curl -s "$GW/sections/ARQSW-01"; echo
}

case "${1:-}" in
  reglas) rules_demo ;;
  estres) stress_demo ;;
  *) main_demo ;;
esac
