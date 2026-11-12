const express = require('express');
const { buildChain } = require('./rules');
const { getStudent, getSection } = require('./catalog');

const app = express();
app.use(express.json());
const chain = buildChain();

const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'validation-service', msg, ...extra }));

app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'validation-service' }));

app.get('/sections/:id', (req, res) => {
  const section = getSection(req.params.id);
  return section
    ? res.json({ sectionId: req.params.id, ...section })
    : res.status(404).json({ error: 'SECTION_NOT_FOUND' });
});

// POST /validate { studentId, sectionId } -> { valid, failedRule?, reason?, trace, credits }
app.post('/validate', (req, res) => {
  const correlationId = req.get('x-correlation-id');
  const { studentId, sectionId } = req.body || {};
  const section = getSection(sectionId);

  if (!studentId || !section) {
    log('Solicitud inválida', { correlationId, studentId, sectionId });
    return res.status(400).json({ valid: false, failedRule: 'INPUT', reason: 'studentId o sectionId inválido' });
  }

  const result = chain.handle({ student: getStudent(studentId), section });
  log(result.valid ? 'Validación curricular APROBADA' : 'Validación curricular RECHAZADA', {
    correlationId,
    studentId,
    sectionId,
    failedRule: result.failedRule,
    chain: result.trace.map((t) => `${t.rule}:${t.passed ? 'OK' : 'FAIL'}`).join(' -> '),
  });
  return res.json({ ...result, credits: section.credits });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => log(`Escuchando en :${port}`));
