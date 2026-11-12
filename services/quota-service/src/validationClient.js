// Flecha C4: quota-service -> validation-service "Valida reglas POST /validate vía [JSON/HTTP]"
const VALIDATION_URL = process.env.VALIDATION_URL || 'http://localhost:3001';

async function validate({ studentId, sectionId }, correlationId) {
  const res = await fetch(`${VALIDATION_URL}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ studentId, sectionId }),
    signal: AbortSignal.timeout(2000), // presupuesto de latencia del salto síncrono
  });
  return res.json();
}

module.exports = { validate };
