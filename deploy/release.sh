#!/usr/bin/env bash
# Run on the VPS with its existing private Compose configuration.
set -Eeuo pipefail
root=${1:?usage: release.sh ROOT SHA}
revision=${2:?usage: release.sh ROOT SHA}
[[ $root =~ ^/[a-zA-Z0-9/_-]+$ && $revision =~ ^[a-f0-9]{40}$ ]] || exit 2
release="$root/releases/$revision"
[[ -f "$root/deploy/.env" && -f "$release/deploy/Dockerfile" ]] || exit 2
exec 9>"$root/deploy/release.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
base=(docker compose --project-directory "$root/deploy" --env-file "$root/deploy/.env" -f "$root/deploy/compose.yaml")
container=$("${base[@]}" ps -q app)
[[ -n $container ]] || { echo 'A running app is required for deployment and rollback.' >&2; exit 1; }
previous=$(docker inspect --format '{{.Image}}' "$container")
previous_revision=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^RELEASE_SHA=//p')
rollback_image="soulwisp-app:rollback-$revision"
docker image tag "$previous" "$rollback_image"
config="$root/deploy/.release-$revision.yaml"
compose=("${base[@]}" -f "$config")
write_config() {
  printf 'services:\n  app:\n    image: "%s"\n    command: ["sh", "-c", "cp -r apps/web/dist/. /exports/ && exec node --import tsx apps/server/src/index.ts"]\n    stop_grace_period: 45s\n    environment:\n      RELEASE_SHA: "%s"\n' "$1" "$2" > "$config"
}
admin() {
  "${base[@]}" exec -T app node -e '
    fetch("http://127.0.0.1:3001/"+process.argv[1],{method:process.argv[2]||"GET"})
      .then(async r=>{if(!r.ok)throw Error("Deployment admin unavailable");console.log(await r.text())})
      .catch(e=>{console.error(e.message);process.exit(1)})' "$@" </dev/null
}
wait_health() {
  "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 app
}
switched=0
drained=0
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
finish() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    if (( switched )); then
      echo 'Deployment failed; restoring the previous application image.' >&2
      write_config "$rollback_image" "$previous_revision"
      if wait_health; then
        cp "$config" "$root/deploy/runtime-image.yaml"
        echo 'Previous application is healthy. Database was not restored.' >&2
      else
        echo 'ROLLBACK FAILED: inspect app logs on the VPS.' >&2
      fi
    elif (( drained )); then
      admin resume POST >/dev/null || echo 'Could not resume admissions; inspect the app.' >&2
    fi
  fi
  rm -f "$config"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Never print Compose's resolved private environment.
game_url=$("${base[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["app"]["build"]["args"]["VITE_GAME_URL"])')
timeout 900 docker build --build-arg "VITE_GAME_URL=$game_url" --label "org.opencontainers.image.revision=$revision" -t "soulwisp-app:$revision" -f "$release/deploy/Dockerfile" "$release"
# Older servers must receive the deployment-admin feature once manually.
admin status >/dev/null
# Set this before the request so an interrupted request also resumes admissions.
drained=1
admin drain POST >/dev/null
deadline=$((SECONDS + ${DRAIN_TIMEOUT_SECONDS:-2100}))
while :; do
  status=$(admin status)
  count=$(python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["draining"] is True; print(s["rooms"])' <<< "$status")
  [[ $count == 0 ]] && break
  (( SECONDS < deadline )) || { echo 'Rooms remain active; deployment cancelled.' >&2; exit 1; }
  sleep 10
done
"${base[@]}" exec -T backup sh /scripts/backup.sh </dev/null
write_config "soulwisp-app:$revision" "$revision"
switched=1
wait_health
# Verify HTTPS routing to this exact release, not only container readiness.
public_url=${PUBLIC_APP_URL:-https://gaming.byron.wang}
for ((attempt=0; attempt<12; attempt++)); do
  if curl --fail --silent --show-error --max-time 10 "$public_url/api/health" |
    python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["ok"] and s["revision"] == sys.argv[1]' "$revision"; then
    cp "$config" "$root/deploy/runtime-image.yaml"
    printf '%s\n' "$revision" > "$root/deploy/current-revision"
    echo "Deployed $revision; previous image retained as $rollback_image."
    exit 0
  fi
  sleep 5
done
exit 1
