const Rule = require('./Rule');

// Tope de créditos según promedio: prueba académica (< 3.0) => 12; regular => 20; excelencia (>= 4.5) => 24.
const creditCapFor = (gpa) => (gpa < 3.0 ? 12 : gpa >= 4.5 ? 24 : 20);

class CreditLimitRule extends Rule {
  constructor() {
    super('CREDIT_LIMIT');
  }

  check({ student, section }) {
    const cap = creditCapFor(student.gpa);
    const total = student.enrolledCredits + section.credits;
    return total <= cap
      ? { ok: true }
      : { ok: false, reason: `Excede tope de créditos: ${total} > ${cap} (promedio ${student.gpa})` };
  }
}

module.exports = CreditLimitRule;
