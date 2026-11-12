const PrerequisiteRule = require('./PrerequisiteRule');
const CorequisiteRule = require('./CorequisiteRule');
const CreditLimitRule = require('./CreditLimitRule');
const ScheduleConflictRule = require('./ScheduleConflictRule');

// ESC-4: agregar una regla = crear la clase y encadenarla aquí. Ningún otro servicio cambia.
function buildChain() {
  const head = new PrerequisiteRule();
  head
    .setNext(new CorequisiteRule())
    .setNext(new CreditLimitRule())
    .setNext(new ScheduleConflictRule());
  return head;
}

module.exports = { buildChain };
