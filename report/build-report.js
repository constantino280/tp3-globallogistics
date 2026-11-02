'use strict';
// Genera report/informe.html a partir de los CSV de results/ y de los archivos
// reales del repositorio, para que el informe no pueda desalinearse del código.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REPO = 'https://github.com/constantino280/tp3-globallogistics';

function csv(p) {
  const [head, ...rows] = read(p).trim().split('\n');
  const keys = head.split(',');
  return rows.map((r) => {
    const o = {};
    r.split(',').forEach((v, i) => { o[keys[i]] = i === 0 && isNaN(v) ? v : Number(v); });
    return o;
  });
}
const ab = csv('results/ab_summary.csv');
const k6a = csv('results/k6_summary.csv');
const k6b = csv('results/k6_sweep2.csv');
const fmt = (n, d = 0) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

function aggregate(prefix) {
  const r = ab.filter((x) => x.test.startsWith(prefix));
  const avg = (k) => r.reduce((a, x) => a + x[k], 0) / r.length;
  const span = (k) => [Math.min(...r.map((x) => x[k])), Math.max(...r.map((x) => x[k]))];
  return { r, avg, span, complete: r.reduce((a, x) => a + x.complete, 0), failed: r.reduce((a, x) => a + x.failed + x.non2xx, 0) };
}
const mod = aggregate('moderate-');
const ext = aggregate('extreme-');
const SLO = { p95: 100, p99: 200, max: 500 };
const verdict = (ok) => (ok ? '<span class="ok">✓ Cumple</span>' : '<span class="bad">✗ No cumple</span>');

function scenarioRows(a) {
  return a.r.map((x) => `<tr><td>${x.test.split('-')[1]}</td><td>${fmt(x.complete)}</td><td>${fmt(x.rps)}</td><td>${fmt(x.mean_ms, 1)}</td><td>${x.p50_ms}</td><td>${x.p95_ms}</td><td>${x.p99_ms}</td><td>${fmt(x.max_ms)}</td><td>${x.failed + x.non2xx}</td></tr>`).join('');
}

// ---- Gráficos SVG estáticos (el destino es un PDF) ----
const C = { a: '#2a78d6', b: '#eb6834', c: '#1baf7a', ink: '#0b0b0b', mute: '#52514e', grid: '#e4e3df', slo: '#8a8984' };

function logTicks(min, max) {
  const t = [];
  for (let e = Math.floor(Math.log10(min)); 10 ** e <= max; e++) t.push(10 ** e);
  return t;
}

function lineChart({ series, xs, xLabel, xLog, yMin, yMax, sloLines = [], width = 720, height = 280 }) {
  const m = { l: 56, r: 110, t: 14, b: 44 };
  const W = width - m.l - m.r; const H = height - m.t - m.b;
  const X = xLog
    ? (v) => m.l + (Math.log10(v) - Math.log10(xs[0])) / (Math.log10(xs[xs.length - 1]) - Math.log10(xs[0])) * W
    : (v) => m.l + (v - xs[0]) / (xs[xs.length - 1] - xs[0]) * W;
  const Y = (v) => m.t + H - (Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin)) * H;
  let s = `<svg viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg">`;
  for (const t of logTicks(yMin, yMax)) {
    s += `<line x1="${m.l}" x2="${m.l + W}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" class="ax">${fmt(t)}</text>`;
  }
  for (const x of xs) s += `<text x="${X(x)}" y="${m.t + H + 18}" text-anchor="middle" class="ax">${fmt(x)}</text>`;
  s += `<text x="${m.l + W / 2}" y="${height - 6}" text-anchor="middle" class="ax">${xLabel}</text>`;
  s += `<text x="14" y="${m.t + H / 2}" text-anchor="middle" class="ax" transform="rotate(-90 14 ${m.t + H / 2})">Latencia (ms, escala log)</text>`;
  for (const l of sloLines) {
    s += `<line x1="${m.l}" x2="${m.l + W}" y1="${Y(l.v)}" y2="${Y(l.v)}" stroke="${C.slo}" stroke-dasharray="5 4"/><text x="${m.l + 4}" y="${Y(l.v) - 4}" class="ax">${l.label}</text>`;
  }
  for (const d of series) {
    const pts = d.points.map(([x, y]) => `${X(x).toFixed(1)},${Y(Math.max(y, yMin)).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${d.color}" stroke-width="2"/>`;
    for (const [x, y] of d.points) s += `<circle cx="${X(x)}" cy="${Y(Math.max(y, yMin))}" r="4" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
    const [lx, ly] = d.points[d.points.length - 1];
    s += `<text x="${X(lx) + 9}" y="${Y(ly) + 4 + (d.dy || 0)}" class="lab">${d.label}</text>`;
  }
  return `${s}</svg>`;
}

const ramp = ab.filter((x) => x.test.startsWith('ramp-'));
const chartRamp = lineChart({
  xs: ramp.map((x) => x.concurrency), xLog: true, xLabel: 'Usuarios concurrentes (ab)', yMin: 1, yMax: 3000,
  sloLines: [{ v: SLO.p95, label: 'Objetivo p95: 100 ms' }],
  series: [
    { label: 'p99', color: C.b, dy: -10, points: ramp.map((x) => [x.concurrency, x.p99_ms]) },
    { label: 'p95', color: C.a, dy: 3, points: ramp.map((x) => [x.concurrency, x.p95_ms]) },
    { label: 'p50', color: C.c, dy: 14, points: ramp.map((x) => [x.concurrency, x.p50_ms]) },
  ],
});
const rates = [1000, 1500, 2000, 2500, 3000, 3500, 4000];
const chartRate = lineChart({
  xs: rates, xLog: false, xLabel: 'Tasa de llegada objetivo (req/s, k6)', yMin: 1, yMax: 5000,
  sloLines: [{ v: SLO.p95, label: 'Objetivo p95: 100 ms' }],
  series: [
    { label: 'p95 pasada 1', color: C.b, dy: -8, points: k6a.filter((x) => x.target_rps <= 3500).map((x) => [x.target_rps, x.p95_ms]) },
    { label: 'p95 pasada 2', color: C.a, dy: 6, points: k6b.filter((x) => x.target_rps <= 4000).map((x) => [x.target_rps, x.p95_ms]) },
  ],
});
const scale = ab.filter((x) => x.test.startsWith('scale-n'));
const chartScale = (() => {
  const w = 720, h = 170, l = 96, barMax = 430;
  const max = Math.max(...scale.map((x) => x.rps));
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg">`;
  scale.forEach((x, i) => {
    const y = 8 + i * 39; const bw = (x.rps / max) * barMax;
    const n = Number(x.test.replace('scale-n', ''));
    s += `<text x="${l - 10}" y="${y + 20}" text-anchor="end" class="lab">${n} ${n === 1 ? 'réplica' : 'réplicas'}</text>`;
    s += `<rect x="${l}" y="${y}" width="${bw}" height="30" rx="4" fill="${C.a}"/>`;
    s += `<text x="${l + bw + 8}" y="${y + 20}" class="lab">${fmt(x.rps)} req/s · p95 ${x.p95_ms} ms</text>`;
  });
  return `${s}</svg>`;
})();

const diagram = `<svg viewBox="0 0 720 230" role="img" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${C.mute}"/></marker></defs>
<rect x="10" y="85" width="130" height="60" rx="6" class="bx"/><text x="75" y="111" text-anchor="middle" class="lab">Cliente / ab / k6</text><text x="75" y="129" text-anchor="middle" class="ax">:8080</text>
<rect x="225" y="70" width="165" height="90" rx="6" class="bxa"/><text x="307" y="98" text-anchor="middle" class="lab">HAProxy (1 instancia)</text><text x="307" y="117" text-anchor="middle" class="ax">round-robin · cola · maxconn 32</text><text x="307" y="134" text-anchor="middle" class="ax">health check /health cada 2 s</text><text x="307" y="150" text-anchor="middle" class="ax">límite 2 CPU · 256 MB</text>
<rect x="520" y="12" width="190" height="56" rx="6" class="bx"/><text x="615" y="36" text-anchor="middle" class="lab">api réplica 1</text><text x="615" y="54" text-anchor="middle" class="ax">Node 22 · 1 CPU · 128 MB</text>
<rect x="520" y="87" width="190" height="56" rx="6" class="bx"/><text x="615" y="111" text-anchor="middle" class="lab">api réplica 2</text><text x="615" y="129" text-anchor="middle" class="ax">Node 22 · 1 CPU · 128 MB</text>
<rect x="520" y="162" width="190" height="56" rx="6" class="bx"/><text x="615" y="186" text-anchor="middle" class="lab">api réplica 3</text><text x="615" y="204" text-anchor="middle" class="ax">Node 22 · 1 CPU · 128 MB</text>
<rect x="225" y="186" width="165" height="36" rx="6" class="bx"/><text x="307" y="209" text-anchor="middle" class="ax">DNS de Docker (127.0.0.11)</text>
<path d="M140 115H222" stroke="${C.mute}" marker-end="url(#ar)"/>
<path d="M390 100L518 42M390 115H518M390 130L518 188" stroke="${C.mute}" fill="none" marker-end="url(#ar)"/>
<path d="M307 160V184" stroke="${C.mute}" stroke-dasharray="4 3" marker-end="url(#ar)"/>
</svg>`;

const code = (file, lang) => `<pre class="code"><code>${esc(read(file))}</code></pre>`;
const out = (file) => `<pre class="term"><code>${esc(read(file))}</code></pre>`;

const resilience = read('results/resilience.txt');
const sectionB = resilience.slice(resilience.indexOf('=== B.'), resilience.indexOf('=== C.'));
const crashLine = sectionB.split('\n').find((l) => /^1500,/.test(l)).split(',');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>TP3 - Arquitectura de Sistemas 2026</title>
<style>
@page{size:A4;margin:17mm 16mm}
*{box-sizing:border-box}
body{font:10.5pt/1.45 "Segoe UI",Arial,sans-serif;color:${C.ink};margin:0}
header{border-bottom:2px solid ${C.ink};padding-bottom:10px;margin-bottom:14px}
header h1{font-size:19pt;margin:2px 0 6px}
.meta{color:${C.mute};font-size:9.5pt;margin:1px 0}
a{color:#1a5fb4}
h2{font-size:13.5pt;margin:20px 0 6px;break-after:avoid}
h3{font-size:11pt;margin:13px 0 4px;break-after:avoid}
p{margin:5px 0 7px}
ul{margin:4px 0 8px;padding-left:18px}li{margin:2px 0}
table{border-collapse:collapse;width:100%;font-size:9pt;margin:6px 0 10px;break-inside:avoid}
th{text-align:left;border-bottom:1.5px solid ${C.ink};padding:3px 6px}
td{border-bottom:1px solid ${C.grid};padding:3px 6px;vertical-align:top}
td.n,th.n{text-align:right}
pre{font:7.8pt/1.32 Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:5px 0 10px}
.code{background:#f5f4f1;padding:8px;border-radius:4px}
.term{background:#14161a;color:#e6e6e3;padding:8px;border-radius:4px}
pre,figure{-webkit-print-color-adjust:exact;print-color-adjust:exact}
figure{margin:8px 0 12px;break-inside:avoid}
figcaption{font-size:8.5pt;color:${C.mute};margin-top:3px}
figure img{max-width:100%;border:1px solid ${C.grid};display:block}
.callout{border-left:3px solid ${C.a};padding:5px 10px;background:#f3f7fc;margin:8px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;break-inside:avoid}
.ok{color:#006300;font-weight:600}.bad{color:#b3261e;font-weight:600}
.ax{font:11px "Segoe UI",Arial,sans-serif;fill:${C.mute}}
.lab{font:600 12px "Segoe UI",Arial,sans-serif;fill:${C.ink}}
.bx{fill:#fff;stroke:${C.mute}}.bxa{fill:#eef4fb;stroke:${C.a}}
.shots{display:flex;flex-direction:column;gap:4px}
</style></head><body>
<header>
<p class="meta">Licenciatura en Sistemas de Información · Arquitectura de Sistemas · Ciclo 2026 · Universidad Champagnat</p>
<h1>Trabajo Práctico N.º 3: Despliegue de Arquitectura Cloud-Native</h1>
<p class="meta"><b>Repositorio Git:</b> <a href="${REPO}">${REPO}</a></p>
<p class="meta"><b>Integrantes:</b> Constantino Mateu · Arian Nuñez · Ignacio Azzolina</p>
<p class="meta"><b>Fecha de entrega:</b> 02/11/2026 · <b>Caso:</b> GlobalLogistics S.A.</p>
</header>

<h2>1. Resumen de resultados</h2>
<p>Desplegamos con <code>docker compose</code> un balanceador HAProxy y tres réplicas de un microservicio REST en Node.js. Peticiones consecutivas son atendidas por instancias distintas, y las réplicas que fallan salen de rotación automáticamente.</p>
<ul>
<li><b>100 usuarios concurrentes:</b> ${fmt(mod.avg('rps'))} req/s, latencia promedio de ${fmt(mod.avg('mean_ms'), 1)} ms, p95 de ${mod.span('p95_ms')[0]}–${mod.span('p95_ms')[1]} ms, p99 de ${mod.span('p99_ms')[0]}–${mod.span('p99_ms')[1]} ms y máximo de ${mod.span('max_ms')[0]}–${mod.span('max_ms')[1]} ms. Cumple el objetivo de tiempo real blando que definimos.</li>
<li><b>2000 usuarios concurrentes:</b> ${fmt(ext.avg('rps'))} req/s, latencia promedio de ${fmt(ext.avg('mean_ms'), 0)} ms, p95 de ${ext.span('p95_ms')[0]}–${ext.span('p95_ms')[1]} ms, p99 de ${fmt(ext.span('p99_ms')[0])}–${fmt(ext.span('p99_ms')[1])} ms y máximo de ${fmt(ext.span('max_ms')[0])}–${fmt(ext.span('max_ms')[1])} ms. No cumple el objetivo, aunque tampoco hubo errores HTTP.</li>
<li><b>Punto de degradación:</b> entre 100 y 250 usuarios concurrentes en lazo cerrado, y entre 3000 y 3500 req/s a tasa fija en la mejor medición. El nivel que resultó estable en las dos pasadas de k6 es de 2000 req/s.</li>
<li><b>Tiempo real:</b> el sistema puede ofrecer tiempo real <i>blando</i> por debajo de ese punto, pero no tiempo real <i>duro</i>, porque la plataforma no acota la latencia máxima.</li>
</ul>

<h2>2. Arquitectura desplegada</h2>
<figure>${diagram}<figcaption>Figura 1. Único punto de entrada publicado: el balanceador. Las réplicas no exponen puertos al host.</figcaption></figure>
<table><tr><th style="width:27%">Decisión</th><th>Justificación</th></tr>
<tr><td>HAProxy en lugar de nginx</td><td>El apunte de la Unidad III indica que nginx open source solo tiene health checks pasivos (<code>max_fails</code>), que sacan el nodo después de fallar peticiones reales, y que los activos están en NGINX Plus, HAProxy o balanceadores cloud. La consigna pide comprobar el estado de las réplicas, y un check activo lo detecta sin sacrificar tráfico.</td></tr>
<tr><td>Round-robin</td><td>Todas las peticiones tienen un costo similar, el supuesto de este algoritmo según el apunte.</td></tr>
<tr><td>Servicio sin estado</td><td>Evita sticky sessions: cualquier réplica atiende cualquier petición.</td></tr>
<tr><td>Discovery server-side por DNS de Docker</td><td>La infraestructura es efímera: una réplica reiniciada puede cambiar de IP. El código no conoce el registro, la opción más reversible según el apunte.</td></tr>
<tr><td><code>maxconn 32</code> por réplica</td><td>Mantiene el exceso en la cola del balanceador. Node atiende de a una petición por vez, así que acumularlas en la réplica también demoraría sus respuestas a <code>/health</code>.</td></tr>
<tr><td>Límites de CPU y memoria</td><td>Hacen reproducible la saturación e independiente del tamaño del host.</td></tr>
</table>

<h2>3. Consigna 1: Infraestructura como código</h2>
<p>El manifiesto define exactamente un balanceador (<code>lb</code>) y tres réplicas (<code>api</code>, con <code>deploy.replicas: 3</code>). Los generadores de carga usan el perfil <code>tools</code>, de modo que <code>docker compose up -d</code> no los levanta.</p>
<h3>docker-compose.yml</h3>${code('docker-compose.yml')}
<h3>Verificación: docker compose ps</h3>${out('results/compose_ps.txt')}

<h2>4. Consigna 2: Microservicio y balanceo</h2>
<p><code>GET /</code> devuelve el hostname del contenedor en el campo <code>instance</code>. Cada petición ejecuta 1000 iteraciones de PBKDF2 para simular el costo de CPU de una cotización. Medimos ese cálculo en ${'0,41–0,62'} ms según el momento.</p>
<h3>api/server.js</h3>${code('api/server.js')}
<h3>lb/haproxy.cfg (balanceador con health checks)</h3>${code('lb/haproxy.cfg')}
<h3>Evidencia de balanceo</h3>
<figure><img src="img/terminal-balanceo.png" alt="Salida de curl con instancias alternadas"><figcaption>Figura 2. Peticiones consecutivas al balanceador, atendidas por tres IDs de instancia. De 300 peticiones, cada instancia atendió exactamente 100.</figcaption></figure>
<figure class="shots"><img src="img/instance1.png" alt="Respuesta 1 en navegador"><img src="img/instance2.png" alt="Respuesta 2 en navegador"><img src="img/instance3.png" alt="Respuesta 3 en navegador"><figcaption>Figura 3. Cargas de http://localhost:8080/ en el navegador. No siguen el orden estricto de la Figura 2 porque el navegador también pide /favicon.ico, que consume un turno del round-robin.</figcaption></figure>
<figure><img src="img/haproxy-stats.png" alt="Panel de estadísticas de HAProxy"><figcaption>Figura 4. Panel de HAProxy (http://localhost:8404/stats). Las 3 réplicas están activas; las ranuras restantes quedan inactivas hasta que se escale.</figcaption></figure>
<h3>Evidencia de health checks y resiliencia</h3>
<ul>
<li><b>Falla de salud:</b> una réplica que responde 503 en <code>/health</code> salió de rotación en 6 s (3 fallos cada 2 s). Mientras estuvo afuera, 30 peticiones se repartieron 15 y 15 entre las otras dos. Al recuperarse, volvió en 4 s.</li>
<li><b>Caída real bajo carga:</b> matamos el proceso de una réplica con ${fmt(crashLine[0])} req/s en curso. Fallaron ${fmt(crashLine[7], 3)} % de las peticiones (unas 20 de 90.000), el p99 fue de ${fmt(crashLine[5], 1)} ms y el pico de ${fmt(crashLine[6], 0)} ms. Docker reinició el contenedor sin intervención. El reinicio fue tan rápido que la réplica no llegó a figurar como DOWN en el muestreo cada 2 s, así que esos errores probablemente corresponden a peticiones en curso al momento de la caída.</li>
<li><b>Escalado:</b> con <code>--scale api=5</code> el balanceador incorporó las réplicas nuevas sin tocar su configuración, con 10 peticiones por instancia, y al volver a 3 las retiró.</li>
</ul>
<p>La numeración de las ranuras de HAProxy (<code>api-1</code>, <code>api-2</code>…) no coincide con la de Compose: en la prueba, la réplica 2 de Compose ocupaba la ranura <code>api-1</code>. El registro completo está en <code>results/resilience.txt</code>.</p>

<h2>5. Consigna 3: Pruebas de estrés y atributos de calidad</h2>
<h3>5.1 Método</h3>
<table><tr><th style="width:24%">Prueba</th><th>Herramienta y parámetros</th><th>Qué responde</th></tr>
<tr><td>Escenarios pedidos</td><td><code>ab -k -c 100</code> y <code>-c 2000</code>, 60 s, 3 repeticiones</td><td>Métricas de carga moderada y extrema</td></tr>
<tr><td>Rampa</td><td><code>ab -k</code>, de 1 a 4000 usuarios, 20 s por nivel</td><td>A qué concurrencia degrada</td></tr>
<tr><td>Tasa fija</td><td>k6 <code>constant-arrival-rate</code>, 30 s por nivel, 2 pasadas</td><td>A qué tráfico real degrada</td></tr>
<tr><td>Escalado</td><td><code>ab -c 500</code> con 1, 2, 3 y 5 réplicas</td><td>Si agregar réplicas agrega capacidad</td></tr>
</table>
<p>Usamos k6 además de <code>ab</code> porque <code>ab</code> trabaja en lazo cerrado: cada usuario espera su respuesta antes de enviar otra petición, sin pausas. Así el generador frena solo cuando el sistema se atrasa y siempre lleva la CPU cerca del 100 %. A tasa fija, en cambio, las llegadas no dependen de la velocidad del sistema. Ambos generadores corren dentro de la red de Docker para no medir el reenvío de puertos de Docker Desktop.</p>
<div class="callout"><b>Objetivo de tiempo real (supuesto nuestro).</b> La consigna no fija un valor numérico. Lo definimos para poder evaluar el resultado, tomando como referencia una operación interactiva de logística: <b>p95 ≤ ${SLO.p95} ms, p99 ≤ ${SLO.p99} ms y máximo ≤ ${SLO.max} ms</b>, sin errores. Es un objetivo de tiempo real blando: incumplirlo degrada el servicio, pero no es una falla catastrófica.</div>

<h3>5.2 Reporte de métricas</h3>
<p><b>Concurrencia moderada (100 usuarios, 60 s).</b> Tiempos en milisegundos.</p>
<table><tr><th>Corrida</th><th>Peticiones</th><th>Req/s</th><th>Promedio</th><th>p50</th><th>p95</th><th>p99</th><th>Máx.</th><th>Errores</th></tr>${scenarioRows(mod)}</table>
<p><b>Concurrencia extrema (2000 usuarios, 60 s, CPU de réplicas saturada).</b> Tiempos en milisegundos.</p>
<table><tr><th>Corrida</th><th>Peticiones</th><th>Req/s</th><th>Promedio</th><th>p50</th><th>p95</th><th>p99</th><th>Máx.</th><th>Errores</th></tr>${scenarioRows(ext)}</table>
<p>CPU promedio (<code>docker stats</code>, donde 100 % equivale a un núcleo): las réplicas estuvieron entre 92 % y 102 % en ambos escenarios, y el balanceador entre 153 % y 163 % de sus 200 % disponibles. El <code>ab</code> usó menos de 40 %, así que no fue el cuello de botella.</p>

<h3>5.3 Punto de degradación</h3>
<figure>${chartRamp}<figcaption>Figura 5. Rampa de concurrencia con ab. Las líneas son percentiles de latencia; la línea punteada es el objetivo de p95.</figcaption></figure>
<table><tr><th class="n">Usuarios</th><th class="n">Req/s</th><th class="n">Promedio (ms)</th><th class="n">p50</th><th class="n">p95</th><th class="n">p99</th><th class="n">Máx.</th><th class="n">Errores</th></tr>
${ramp.map((x) => `<tr><td class="n">${fmt(x.concurrency)}</td><td class="n">${fmt(x.rps)}</td><td class="n">${fmt(x.mean_ms, 1)}</td><td class="n">${x.p50_ms}</td><td class="n">${fmt(x.p95_ms)}</td><td class="n">${fmt(x.p99_ms)}</td><td class="n">${fmt(x.max_ms)}</td><td class="n">${x.failed + x.non2xx}</td></tr>`).join('')}</table>
<figure>${chartRate}<figcaption>Figura 6. p95 a tasa fija con k6. Las dos pasadas difieren en 2500 y 3000 req/s por la variación del host (ver 5.6).</figcaption></figure>
<table><tr><th class="n">Objetivo (req/s)</th><th class="n">Lograda p.1</th><th class="n">p95 p.1</th><th class="n">p99 p.1</th><th class="n">Máx. p.1</th><th class="n">Lograda p.2</th><th class="n">p95 p.2</th><th class="n">p99 p.2</th><th class="n">Máx. p.2</th></tr>
${[...new Set([...k6a, ...k6b].map((x) => x.target_rps))].sort((a, b) => a - b).map((t) => {
  const a = k6a.find((x) => x.target_rps === t); const b = k6b.find((x) => x.target_rps === t);
  const c = (o, k, d = 0) => (o ? fmt(o[k], d) : '–');
  return `<tr><td class="n">${fmt(t)}</td><td class="n">${c(a, 'achieved_rps')}</td><td class="n">${c(a, 'p95_ms', 1)}</td><td class="n">${c(a, 'p99_ms', 1)}</td><td class="n">${c(a, 'max_ms')}</td><td class="n">${c(b, 'achieved_rps')}</td><td class="n">${c(b, 'p95_ms', 1)}</td><td class="n">${c(b, 'p99_ms', 1)}</td><td class="n">${c(b, 'max_ms')}</td></tr>`;
}).join('')}</table>
<p>Tiempos en milisegundos. No hubo peticiones fallidas en ningún nivel, pero sobre la capacidad k6 descartó llegadas que no pudo iniciar, por lo que esas latencias subestiman la espera real.</p>

<h3>5.4 Análisis crítico</h3>
<p><b>¿En qué punto degrada?</b> Por concurrencia, el p95 pasa de ${ramp.find((x) => x.concurrency === 100).p95_ms} ms con 100 usuarios a ${ramp.find((x) => x.concurrency === 250).p95_ms} ms con 250, donde supera el objetivo, y a ${ramp.find((x) => x.concurrency === 500).p95_ms} ms con 500. Por tráfico, la mejor pasada se mantiene con p95 de ${fmt(k6b.find((x) => x.target_rps === 3000).p95_ms, 1)} ms a 3000 req/s y salta a ${fmt(k6b.find((x) => x.target_rps === 3500).p95_ms)} ms a 3500 req/s. El quiebre es abrupto, como predice la teoría de colas cuando la utilización se acerca a 1. La primera pasada ya había fallado el objetivo a 2500 req/s, mientras que 2000 req/s fue estable en las dos, así que ese es el nivel que recomendamos como límite operativo.</p>
<p><b>¿Cumple las restricciones de tiempo real?</b></p>
<table><tr><th>Escenario</th><th>p95 ≤ ${SLO.p95} ms</th><th>p99 ≤ ${SLO.p99} ms</th><th>Máx. ≤ ${SLO.max} ms</th><th>Errores</th></tr>
<tr><td>100 usuarios (peor de 3 corridas)</td><td>${mod.span('p95_ms')[1]} ms ${verdict(mod.span('p95_ms')[1] <= SLO.p95)}</td><td>${mod.span('p99_ms')[1]} ms ${verdict(mod.span('p99_ms')[1] <= SLO.p99)}</td><td>${mod.span('max_ms')[1]} ms ${verdict(mod.span('max_ms')[1] <= SLO.max)}</td><td>${mod.failed}</td></tr>
<tr><td>2000 usuarios (peor de 3 corridas)</td><td>${ext.span('p95_ms')[1]} ms ${verdict(ext.span('p95_ms')[1] <= SLO.p95)}</td><td>${fmt(ext.span('p99_ms')[1])} ms ${verdict(ext.span('p99_ms')[1] <= SLO.p99)}</td><td>${fmt(ext.span('max_ms')[1])} ms ${verdict(ext.span('max_ms')[1] <= SLO.max)}</td><td>${ext.failed}</td></tr></table>
<p>Con 100 usuarios el máximo cumple, pero con poco margen: en corridas de control de 10 s llegó a 508 ms (<code>results/control_runs.txt</code>), apenas por encima del objetivo. Además, el máximo fue de 3,5 a 4,5 veces el p99, de modo que la cola no está acotada. Este despliegue puede sostener tiempo real blando con carga moderada, pero no tiempo real duro: Linux, el planificador de CPU de los contenedores, el recolector de basura de Node y la red virtual no ofrecen ninguna garantía de peor caso.</p>
<p><b>¿Cómo se justifica por la arquitectura?</b></p>
<ul>
<li><b>El cuello de botella son las réplicas.</b> Node ejecuta el cálculo en su único hilo principal y cada réplica tiene 1 CPU. En ambos escenarios las réplicas operan cerca del 100 %, por lo que la capacidad queda fija en unas 3000–4500 req/s en estas corridas y lo único que crece con los usuarios es la espera. Con ${fmt(ext.avg('rps'))} req/s y 2000 usuarios, una espera promedio de unos ${fmt(ext.avg('mean_ms'))} ms es lo que anticipa la ley de Little.</li>
<li><b>La cola está en el balanceador.</b> Con <code>maxconn 32</code>, cada réplica recibe como máximo 32 peticiones y el resto espera en HAProxy, donde observamos hasta 3927 en cola. Por eso la saturación se manifiesta como latencia y no como errores: 0 errores en ${fmt(ext.complete)} peticiones del escenario extremo.</li>
<li><b>Los health checks resistieron la saturación.</b> Al terminar las pruebas de carga, ninguna réplica registraba checks fallidos (<code>chkfail=0</code>). Las réplicas deben responder <code>/health</code> en menos de 1 s, y lo consiguen porque esperan como mucho unas 32 peticiones. Sin ese límite, la saturación podría hacer que el balanceador las diera de baja y empeorar la situación en cascada.</li>
<li><b>La escala horizontal ayuda hasta cierto punto.</b> Como muestra la Figura 7, pasar de 1 a 2 réplicas duplicó el rendimiento (×${fmt(scale[1].rps / scale[0].rps, 2)}), pero de 3 a 5 solo sumó ×${fmt(scale[3].rps / scale[2].rps, 2)}. Con 5 réplicas el balanceador ya usa 172 % de sus 200 %, y todo compite por el mismo host: el cuello empieza a moverse fuera de las réplicas, el límite que anticipa el apunte. El rendimiento con 2 y 3 réplicas (×${fmt(scale[2].rps / scale[1].rps, 2)}) también puede estar afectado por la variación del host.</li>
<li><b>Por encima de la capacidad, el rendimiento cae.</b> A tasa fija pasa de ${fmt(k6a.find((x) => x.target_rps === 5000).achieved_rps)} req/s con 5000 de objetivo a ${fmt(k6a.find((x) => x.target_rps === 8000).achieved_rps)} con 8000. Nuestra hipótesis, que no verificamos, es que k6 y HAProxy le quitan CPU a las réplicas en el mismo host, ya que k6 llegó a usar más de 4 núcleos.</li>
</ul>
<figure>${chartScale}<figcaption>Figura 7. Rendimiento con 500 usuarios según la cantidad de réplicas (una corrida de 20 s por nivel).</figcaption></figure>

<h3>5.5 Recomendaciones</h3>
<ul>
<li><b>Descartar antes de esperar:</b> bajar <code>timeout queue</code> de 30 s a un valor cercano al objetivo (por ejemplo, 500 ms) para responder 503 rápido en lugar de hacer esperar segundos. No lo probamos.</li>
<li><b>Autoescalado real:</b> Compose no escala solo. Con estas pruebas demostramos que el balanceador incorpora réplicas sin reconfigurarse, pero la decisión sigue siendo un comando. En producción la tomaría Kubernetes HPA o ECS, disparando antes del quiebre: cerca de 670 req/s por réplica (2000 req/s entre 3).</li>
<li><b>Eliminar el punto único de fallo:</b> el balanceador único pedido por la consigna es un SPOF. Se mitiga con un par activo/pasivo y VRRP, o con un balanceador gestionado.</li>
<li><b>No bloquear el event loop:</b> pasar el cálculo a <code>worker_threads</code> aprovecharía réplicas con más de una CPU.</li>
</ul>

<h3>5.6 Limitaciones de la medición</h3>
<ul>
<li><b>Host compartido y a batería:</b> todo corrió en una notebook con Intel i5-12450H (8 núcleos, 12 hilos) y 8 GB para Docker sobre WSL2, a batería, con carga entre 29 % y 21 % en la parte final, y con otras aplicaciones abiertas. La capacidad varió mucho: el costo de CPU por petición fue de 0,41 a 0,62 ms en una misma réplica, y hubo picos de 6924 req/s con 10 usuarios y otras corridas de 2500 req/s con la misma concurrencia. <b>Por eso los números deben leerse como rangos y no como capacidad absoluta.</b> La anomalía de la primera pasada de k6 a 2500 req/s es atribuible a este ruido, aunque no pudimos aislar la causa.</li>
<li><b>Generador en el mismo host:</b> <code>ab</code> y k6 compiten por CPU con el sistema medido.</li>
<li><b>Resolución de ab:</b> reporta percentiles en milisegundos enteros, poco preciso con cargas bajas.</li>
<li><b>Lazo cerrado:</b> <code>ab</code> no refleja las peticiones que un cliente real habría enviado durante una demora (<i>coordinated omission</i>), por eso sumamos k6.</li>
<li><b>Muestras de una corrida:</b> la rampa y el escalado tienen una sola corrida por nivel.</li>
<li><b>Carga sintética:</b> el servicio no usa base de datos ni red externa. Con esas dependencias, el cuello podría estar en otro lugar y las réplicas adicionales podrían no ayudar.</li>
</ul>

<h2>6. Conclusión</h2>
<p>La arquitectura cumple lo pedido: un manifiesto levanta 1 balanceador y 3 réplicas, el tráfico se distribuye de forma uniforme y una réplica que falla sale de rotación y se recupera sin intervención. Con 100 usuarios concurrentes los tiempos de respuesta se mantienen dentro del objetivo de tiempo real blando, aunque con poco margen en el máximo. A partir de unos 250 usuarios, o de 3000–3500 req/s, la latencia se dispara porque la CPU de las réplicas se agota y las peticiones esperan en el balanceador. El sistema no pierde peticiones, pero deja de responder a tiempo: gana disponibilidad a costa de latencia, por lo que necesita un límite de cola y autoescalado para sostener el objetivo bajo estrés comercial.</p>

<h2>Anexo: reproducción</h2>
<p>El detalle está en el <a href="${REPO}#readme">README del repositorio</a>. Los resultados crudos de cada corrida están en <code>results/raw/</code>.</p>
<pre class="term"><code>docker compose up -d --build --wait
./scripts/test-balancing.sh
./scripts/test-resilience.sh
./scripts/run-load-tests.sh</code></pre>
</body></html>`;

fs.writeFileSync(path.join(__dirname, 'informe.html'), html);
console.log('informe.html generado');
