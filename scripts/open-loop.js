// Carga de lazo abierto: las peticiones llegan a tasa fija aunque el sistema se
// atrase, como clientes reales independientes. Complementa a ab, que es de lazo
// cerrado y frena solo cuando el servidor se satura.
import http from 'k6/http';

const RATE = Number(__ENV.RATE || 1000);
const DURATION = __ENV.DURATION || '30s';
const OUTPUT = __ENV.OUTPUT || '';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    open_loop: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 200,
      maxVUs: 4000,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  http.get('http://lb:8080/', { timeout: '60s' });
}

export function handleSummary(data) {
  const m = data.metrics;
  const d = m.http_req_duration.values;
  const dropped = m.dropped_iterations ? m.dropped_iterations.values.count : 0;
  const line = [
    RATE,
    m.http_reqs.values.rate.toFixed(1),
    d.avg.toFixed(2),
    d.med.toFixed(2),
    d['p(95)'].toFixed(2),
    d['p(99)'].toFixed(2),
    d.max.toFixed(2),
    (m.http_req_failed.values.rate * 100).toFixed(3),
    dropped,
  ].join(',');
  const out = { stdout: line + '\n' };
  if (OUTPUT) out[OUTPUT] = line + '\n';
  return out;
}
