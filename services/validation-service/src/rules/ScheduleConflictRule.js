const Rule = require('./Rule');

const overlaps = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;

class ScheduleConflictRule extends Rule {
  constructor() {
    super('SCHEDULE_CONFLICT');
  }

  check({ student, section }) {
    const clash = section.schedule.find((s) => student.schedule.some((t) => overlaps(s, t)));
    return clash
      ? { ok: false, reason: `Choque de horario el ${clash.day} ${clash.start}:00-${clash.end}:00` }
      : { ok: true };
  }
}

module.exports = ScheduleConflictRule;
