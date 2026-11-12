const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'quota-service', msg, ...extra }));

module.exports = log;
