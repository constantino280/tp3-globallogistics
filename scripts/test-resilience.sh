#!/usr/bin/env bash
# Tres demostraciones de resiliencia. Salida en results/resilience.txt.
#  A. Health check activo: una réplica declara /health = 503 y sale de rotación.
#  B. Caída real bajo carga: se mata el proceso de una réplica con tráfico en curso.
#  C. Escalado: el balanceador incorpora réplicas nuevas sin tocar su configuración.
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
mkdir -p results
exec > >(tee results/resilience.txt) 2>&1

stamp() { date +%H:%M:%S; }
servers() {
  curl -s "http://localhost:8404/stats;csv" \
    | awk -F, '$1=="cotizador" && $2!="BACKEND" && $18 !~ /MAINT/ {printf "  %-7s %s\n",$2,$18}'
}
instances() {
  for _ in $(seq 1 "$1"); do curl -s http://localhost:8080/; echo; done \
    | sed -E 's/.*"instance":"([^"]+)".*/\1/' | sort | uniq -c
}

echo "=== A. Health check activo ==="
echo "[$(stamp)] Estado inicial:"; servers
echo "[$(stamp)] La réplica 2 pasa a responder 503 en /health"
docker compose exec -T --index 2 api wget -q -O- --post-data='' http://127.0.0.1:8080/chaos/unhealthy; echo
T0=$(date +%s)
until curl -s "http://localhost:8404/stats;csv" | awk -F, '$1=="cotizador" && $18 ~ /^DOWN/ {f=1} END {exit !f}'; do sleep 0.5; done
echo "[$(stamp)] Réplica fuera de rotación tras $(( $(date +%s) - T0 )) s:"; servers
echo "Reparto de 30 peticiones con la réplica fuera:"; instances 30
echo "[$(stamp)] La réplica vuelve a responder 200"
docker compose exec -T --index 2 api wget -q -O- --post-data='' http://127.0.0.1:8080/chaos/healthy; echo
T0=$(date +%s)
until ! curl -s "http://localhost:8404/stats;csv" | awk -F, '$1=="cotizador" && $18 ~ /^DOWN/ {f=1} END {exit !f}'; do sleep 0.5; done
echo "[$(stamp)] Réplica reincorporada tras $(( $(date +%s) - T0 )) s:"; servers
echo "Reparto de 30 peticiones:"; instances 30

echo
echo "=== B. Caída de una réplica bajo carga (k6 a tasa fija, 60 s) ==="
RATE="${RATE:-1500}"
docker compose run --rm -T -e RATE="$RATE" -e DURATION=60s k6 run --quiet /scripts/open-loop.js > results/raw/k6-crash.txt 2>&1 &
K6=$!
sleep 20
echo "[$(stamp)] Se mata el proceso Node de la réplica 2 (sin aviso)"
docker compose exec -T --index 2 api sh -c 'kill -9 $(pidof node)'
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 2; echo "[$(stamp)]"; servers
done
wait $K6
echo "target_rps,achieved_rps,mean_ms,p50_ms,p95_ms,p99_ms,max_ms,failed_pct,dropped"
tail -1 results/raw/k6-crash.txt
docker compose ps api --format 'table {{.Name}}\t{{.Status}}'

echo
echo "=== C. Escalado sin reconfigurar el balanceador ==="
docker compose up -d --no-recreate --scale api=5 --wait 2>/dev/null
sleep 10
echo "[$(stamp)] Con --scale api=5:"; servers
echo "Reparto de 50 peticiones:"; instances 50
docker compose up -d --no-recreate --scale api=3 --wait 2>/dev/null
sleep 10
echo "[$(stamp)] De vuelta a 3 réplicas:"; servers
echo "Reparto de 30 peticiones:"; instances 30
