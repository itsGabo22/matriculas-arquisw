const Rule = require('./Rule');

class PrerequisiteRule extends Rule {
  constructor() {
    super('PREREQUISITE');
  }

  check({ student, section }) {
    const missing = section.prerequisites.filter((c) => !student.approvedCourses.includes(c));
    return missing.length === 0
      ? { ok: true }
      : { ok: false, reason: `Prerrequisitos no aprobados: ${missing.join(', ')}` };
  }
}

module.exports = PrerequisiteRule;
