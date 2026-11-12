// Táctica T-3: Chain of Responsibility + Strategy.
// Cada regla es una estrategia intercambiable; la cadena se corta en la primera violación.
class Rule {
  constructor(name) {
    this.name = name;
    this.next = null;
  }

  setNext(rule) {
    this.next = rule;
    return rule;
  }

  /** @returns {{ok: boolean, reason?: string}} */
  check(_ctx) {
    throw new Error('check() debe implementarse');
  }

  handle(ctx, trace = []) {
    const result = this.check(ctx);
    trace.push({ rule: this.name, passed: result.ok });
    if (!result.ok) return { valid: false, failedRule: this.name, reason: result.reason, trace };
    return this.next ? this.next.handle(ctx, trace) : { valid: true, trace };
  }
}

module.exports = Rule;
