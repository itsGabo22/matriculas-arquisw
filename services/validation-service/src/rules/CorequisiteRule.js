const Rule = require('./Rule');

// Correquisito: debe estar aprobado o inscrito simultáneamente en el mismo periodo.
class CorequisiteRule extends Rule {
  constructor() {
    super('COREQUISITE');
  }

  check({ student, section }) {
    const missing = section.corequisites.filter(
      (c) => !student.approvedCourses.includes(c) && !student.enrolledCourses.includes(c),
    );
    return missing.length === 0
      ? { ok: true }
      : { ok: false, reason: `Correquisitos no inscritos simultáneamente: ${missing.join(', ')}` };
  }
}

module.exports = CorequisiteRule;
