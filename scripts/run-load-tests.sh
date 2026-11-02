#!/usr/bin/env bash
# Batería completa de carga. Requiere el entorno levantado con "docker compose up -d".
# Resultados crudos y resúmenes CSV en results/.
#
#   ./scripts/run-load-tests.sh           batería completa (unos 20 minutos)
#   DURATION_MAIN=20 REPS=1 ./scripts/run-load-tests.sh      versión corta
set -u
export MSYS_NO_PATHCONV=1   # Git Bash en Windows: no reescribir rutas de contenedor.
cd "$(dirname "$0")/.."

R=results
DURATION_MAIN="${DURATION_MAIN:-60}"
DURATION_RAMP="${DURATION_RAMP:-20}"
REPS="${REPS:-3}"
C_MODERATE="${C_MODERATE:-100}"
C_EXTREME="${C_EXTREME:-2000}"
RAMP="${RAMP:-1 10 25 50 100 250 500 1000 2000 4000}"
RATES="${RATES:-1000 1500 2000 2500 3000 3500 4000 5000 6000 8000}"
SCALES="${SCALES:-1 2 3 5}"

mkdir -p "$R/raw" "$R/k6"
rm -f "$R"/raw/* "$R"/k6/*
AB_CSV="$R/ab_summary.csv"
STATS_CSV="$R/docker_stats.csv"
echo "test,concurrency,duration_s,complete,failed,non2xx,rps,mean_ms,p50_ms,p95_ms,p99_ms,max_ms" > "$AB_CSV"
echo "epoch,test,container,cpu_pct,mem" > "$STATS_CSV"

CURRENT_TEST_FILE="$(mktemp)"
sample_stats() {
  while :; do
    local t; t="$(cat "$CURRENT_TEST_FILE")"
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null \
      | sed "s/%//; s/^/$(date +%s),${t},/" >> "$STATS_CSV"
  done
}
sample_stats & SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null; rm -f "$CURRENT_TEST_FILE"' EXIT

# run_ab <etiqueta> <concurrencia> <segundos>
run_ab() {
  local label="$1" c="$2" d="$3" f="$R/raw/$1.txt"
  echo "$label" > "$CURRENT_TEST_FILE"
  echo ">> ab $label: c=$c durante ${d}s"
  docker compose run --rm -T ab -k -r -s 60 -t "$d" -n 50000000 -c "$c" http://lb:8080/ > "$f" 2>/dev/null
  echo "idle" > "$CURRENT_TEST_FILE"
  awk -v label="$label" -v c="$c" -v d="$d" '
    /^Complete requests:/  {complete=$3}
    /^Failed requests:/    {failed=$3}
    /^Non-2xx responses:/  {non2xx=$3}
    /^Requests per second:/ {rps=$4}
    /^Time per request:/ && !mean {mean=$4}
    /^ +50%/ {p50=$2} /^ +95%/ {p95=$2} /^ +99%/ {p99=$2} /^ +100%/ {max=$2}
    END {printf "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",label,c,d,complete,failed,non2xx+0,rps,mean,p50,p95,p99,max}
  ' "$f" | tee -a "$AB_CSV"
  sleep 5
}

echo "== Rampa de concurrencia (lazo cerrado) =="
for c in $RAMP; do run_ab "ramp-c$c" "$c" "$DURATION_RAMP"; done

echo "== Escenario moderado =="
for i in $(seq 1 "$REPS"); do run_ab "moderate-$i" "$C_MODERATE" "$DURATION_MAIN"; done

echo "== Escenario extremo =="
for i in $(seq 1 "$REPS"); do run_ab "extreme-$i" "$C_EXTREME" "$DURATION_MAIN"; done

echo "== Tasa fija (lazo abierto, k6) =="
K6_CSV="$R/k6_summary.csv"
echo "target_rps,achieved_rps,mean_ms,p50_ms,p95_ms,p99_ms,max_ms,failed_pct,dropped" > "$K6_CSV"
for rate in $RATES; do
  echo "k6-$rate" > "$CURRENT_TEST_FILE"
  echo ">> k6 rate=$rate"
  docker compose run --rm -T -e RATE="$rate" -e DURATION=30s -e OUTPUT="/results/k6/$rate.csv" \
    k6 run --quiet /scripts/open-loop.js > "$R/raw/k6-$rate.txt" 2>&1
  echo "idle" > "$CURRENT_TEST_FILE"
  tee -a "$K6_CSV" < "$R/k6/$rate.csv"
  # Deja vaciar la cola del balanceador antes del siguiente nivel.
  sleep 15
done

echo "== Escalado horizontal: misma carga con distinta cantidad de réplicas =="
for n in $SCALES; do
  docker compose up -d --no-recreate --scale api="$n" --wait >/dev/null 2>&1
  # Da tiempo a que el balanceador descubra las réplicas por DNS y pasen sus checks.
  sleep 10
  run_ab "scale-n$n" 500 "$DURATION_RAMP"
done
docker compose up -d --no-recreate --scale api=3 --wait >/dev/null 2>&1

kill $SAMPLER 2>/dev/null
echo "Listo. Resúmenes en $AB_CSV, $K6_CSV y $STATS_CSV"
