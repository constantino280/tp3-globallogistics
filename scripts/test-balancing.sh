#!/usr/bin/env bash
# Muestra que peticiones consecutivas al balanceador las atienden instancias distintas.
set -u
N="${1:-12}"
echo "\$ curl http://localhost:8080/   (x$N)"
for i in $(seq 1 "$N"); do
  printf '%2d  ' "$i"; curl -s http://localhost:8080/; echo
done
echo
echo "Reparto de 300 peticiones por instancia:"
for i in $(seq 1 300); do curl -s http://localhost:8080/; echo; done \
  | sed -E 's/.*"instance":"([^"]+)".*/\1/' | sort | uniq -c
