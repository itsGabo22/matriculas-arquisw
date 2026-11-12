// Anti-Corruption Layer hacia el ERP financiero externo.
// En el walking skeleton el ERP se SIMULA aquí (es un sistema externo, C4 Nivel 1; no es contenedor propio):
// latencia de 1.5–3 s y tasa de fallo configurable (ERP_FAILURE_RATE) para el experimento E-2.
const crypto = require('crypto');

const MIN = Number(process.env.ERP_MIN_LATENCY_MS || 1500);
const MAX = Number(process.env.ERP_MAX_LATENCY_MS || 3000);
const FAILURE_RATE = Number(process.env.ERP_FAILURE_RATE || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkClearanceAndIssueReceipt({ studentId, sectionId, credits }) {
  const latency = Math.round(MIN + Math.random() * (MAX - MIN));
  await sleep(latency);
  if (Math.random() < FAILURE_RATE) {
    const err = new Error('ERP no disponible (HTTP 503 simulado)');
    err.latency = latency;
    throw err;
  }
  // Traducción del modelo del ERP al lenguaje de nuestro contexto (ACL).
  return {
    receiptNumber: `REC-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`,
    clearance: 'PAZ_Y_SALVO',
    amount: credits * 450000,
    currency: 'COP',
    studentId,
    sectionId,
    latency,
  };
}

module.exports = { checkClearanceAndIssueReceipt };
