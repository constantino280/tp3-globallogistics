'use strict';

// Microservicio de cotización de envíos de GlobalLogistics S.A.
// API REST sin dependencias externas y sin estado: cualquier réplica puede
// atender cualquier petición, requisito para balancear sin afinidad.

const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
// Iteraciones PBKDF2 que simulan el costo de CPU de calcular una cotización.
const WORK_ITERATIONS = Number(process.env.WORK_ITERATIONS || 1000);
const CHAOS_ENABLED = process.env.CHAOS_ENABLED === 'true';

const instance = os.hostname();
let forcedUnhealthy = false;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Instance-Id': instance,
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && pathname === '/') {
    // Trabajo síncrono a propósito: bloquea el event loop igual que un cálculo
    // intensivo real, de modo que cada réplica sirve de a una petición por vez.
    crypto.pbkdf2Sync('envio', 'globallogistics', WORK_ITERATIONS, 32, 'sha256');
    return sendJson(res, 200, { service: 'cotizador', instance, status: 'ok' });
  }

  if (req.method === 'GET' && pathname === '/health') {
    return forcedUnhealthy
      ? sendJson(res, 503, { instance, status: 'unhealthy' })
      : sendJson(res, 200, { instance, status: 'healthy' });
  }

  // Inyección de fallas para demostrar los health checks. El balanceador
  // bloquea esta ruta: solo se alcanza desde dentro de la red de la réplica.
  if (CHAOS_ENABLED && req.method === 'POST' && pathname === '/chaos/unhealthy') {
    forcedUnhealthy = true;
    return sendJson(res, 200, { instance, forcedUnhealthy });
  }
  if (CHAOS_ENABLED && req.method === 'POST' && pathname === '/chaos/healthy') {
    forcedUnhealthy = false;
    return sendJson(res, 200, { instance, forcedUnhealthy });
  }

  return sendJson(res, 404, { instance, error: 'not found' });
});

// Mayor que el keep-alive del balanceador, para que nunca sea la réplica quien
// cierre una conexión reutilizable mientras el balanceador la está por usar.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, () => {
  console.log(`cotizador ${instance} escuchando en :${PORT} (iteraciones=${WORK_ITERATIONS})`);
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
