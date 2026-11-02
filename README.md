# TP3: Despliegue de Arquitectura Cloud-Native (GlobalLogistics S.A.)

Arquitectura de Sistemas, ciclo 2026, Universidad Champagnat.
Integrantes: Constantino Mateu, Arian Nuñez e Ignacio Azzolina.

Un balanceador HAProxy con health checks activos y tres réplicas de un microservicio REST en Node.js, definidos en `docker-compose.yml`.

## Requisitos

- Docker con Compose v2 (Docker Desktop en Windows o macOS).
- `bash` y `curl` para los scripts. En Windows, usar Git Bash.

No hace falta instalar `ab` ni `k6`: corren en contenedores.

## Levantar el entorno

```bash
docker compose up -d --build --wait
```

Con la versión anterior de Compose, el comando equivalente es `docker-compose up -d --build`.

Verificar que hay 1 balanceador y 3 réplicas:

```bash
docker compose ps
```

| URL | Qué muestra |
|---|---|
| http://localhost:8080/ | Respuesta del microservicio, con el ID de la instancia en `instance` |
| http://localhost:8404/stats | Estado de las réplicas en HAProxy |

## Reproducir las pruebas

Balanceo entre instancias:

```bash
./scripts/test-balancing.sh
```

Health checks, caída de una réplica bajo carga y escalado (unos 3 minutos). Salida en `results/resilience.txt`:

```bash
./scripts/test-resilience.sh
```

Batería de carga completa (unos 25 minutos). **Sobrescribe `results/`**:

```bash
./scripts/run-load-tests.sh
```

Versión corta de la batería (unos 10 minutos):

```bash
DURATION_MAIN=20 REPS=1 ./scripts/run-load-tests.sh
```

Solo los dos escenarios pedidos, con `ab`:

```bash
docker compose run --rm ab -k -r -s 60 -t 60 -n 50000000 -c 100 http://lb:8080/
```

```bash
docker compose run --rm ab -k -r -s 60 -t 60 -n 50000000 -c 2000 http://lb:8080/
```

La salida de `ab` incluye el promedio (`Time per request`) y los percentiles 95 y 99 en la tabla final.

## Resultados

| Archivo | Contenido |
|---|---|
| `results/ab_summary.csv` | Rampa, escenarios y escalado con `ab` |
| `results/k6_summary.csv`, `results/k6_sweep2.csv` | Tasa fija con k6, dos pasadas |
| `results/docker_stats.csv` | CPU y memoria por contenedor durante las pruebas |
| `results/resilience.txt`, `results/balancing.txt` | Evidencia de resiliencia y balanceo |
| `results/control_runs.txt` | Corridas de control de 10 s |
| `results/raw/` | Salida completa de cada corrida |

Los números dependen del host. Los de este repositorio se midieron en una notebook a batería y varían bastante entre corridas: el análisis está en el informe, en `report/`.

## Regenerar el informe

```bash
node report/build-report.js
```

## Apagar el entorno

```bash
docker compose down
```

## Estructura

```text
docker-compose.yml     1 balanceador, 3 réplicas y generadores de carga
api/                   Microservicio (server.js, Dockerfile)
lb/haproxy.cfg         Balanceador y health checks
scripts/               Pruebas de balanceo, resiliencia y carga
results/               Resultados medidos
report/                Generador del informe e imágenes
```
