#!/bin/bash
# Screenshots of the k8s mod in a scratch Fireflies against the fake kubectl
# (the made-up cluster "nightjar"): never a real cluster, context or host.
#
#   test/shots.sh <herdr-app binary> [out dir]
#
# A scratch home under /var/tmp (its own HC_SESSION, the nocturne layout, zoom
# 1.3, sounds off) with this repository's mod/ linked as mods/k8s and
# k8s/settings.json naming test/fake/kubectl. The window is driven by
# `k8s.press:<keys>` and `k8s.show:{…}`; shots also go to docs/shots/ for the
# README. The app and its core are stopped at the end.
#
# Nothing of the machine's person shows: the window shots are the mod's window
# over the whole app (`k8s.open:{"as":"window","full":true}`); the pane shots
# show one space, "nightjar", whose shell has its own zsh config (a plain
# prompt, the title "nightjar"), not the person's.
set -u
APP=${1:?the herdr-app binary}
REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=${2:-$REPO/docs/shots}
export HERDR_APP_HOME=/var/tmp/k8ss HC_SESSION=k8ss
H=$HERDR_APP_HOME
mkdir -p "$H/mods" "$H/k8s" "$OUT" "$REPO/docs/shots"
ln -sfn "$REPO/mod" "$H/mods/k8s"
echo '{ "layout": "nocturne", "zoom": 1.3, "sounds": { "enabled": false } }' > "$H/settings.json"
printf '{ "kubectl": "%s/test/fake/kubectl", "favourites": ["lantern", "moth"] }\n' "$REPO" > "$H/k8s/settings.json"
export K8S_FAKE_LOG=/var/tmp/k8ss-writes.log
# A neutral shell: its own zsh config, no user or host in its prompt or title.
mkdir -p "$H/zdot" "$H/nightjar"
cat > "$H/zdot/.zshrc" <<'ZSH'
PROMPT='%1~ $ '
RPROMPT=''
HISTFILE=/dev/null
precmd() { print -Pn "\e]0;nightjar\a" }
ZSH
: > "$H/zdot/.zshenv"
export ZDOTDIR="$H/zdot" SHELL=/bin/zsh

P=$(aerospace list-workspaces --focused 2>/dev/null)
T0=$(date +%s)
rm -f "$H/herdr-app.sock"
"$APP" > /var/tmp/k8ss.log 2>&1 &
PID=$!
stop() { kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null; HC_SESSION=k8ss perl -e 'alarm 10; exec @ARGV' hc server stop >/dev/null 2>&1; pkill -f 'herdr-core/k8ss/' 2>/dev/null; echo "up $(( $(date +%s) - T0 )) s"; }
for i in $(seq 30); do [ -S "$H/herdr-app.sock" ] && "$APP" do status >/dev/null 2>&1 && break; kill -0 $PID 2>/dev/null || { echo "app exited"; tail -5 /var/tmp/k8ss.log; exit 1; }; sleep 1; done
for i in $(seq 10); do W=$(aerospace list-windows --all --format "%{window-id} %{app-pid}" 2>/dev/null | awk -v p=$PID '$2==p {print $1}'); [ -n "$W" ] && break; sleep 1; done
[ -n "${W:-}" ] && { aerospace move-node-to-workspace --window-id "$W" 5; aerospace workspace "$P" 2>/dev/null; }

do_() { kill -0 $PID 2>/dev/null || { echo "app gone"; stop; exit 1; }; R=$(perl -e 'alarm 10; exec @ARGV' "$APP" do "$@" 2>&1) || echo "do $*: $R" | head -2; }
shot() { sleep "${2:-1.5}"; do_ window.maximize; sleep 0.6; perl -e 'alarm 10; exec @ARGV' "$APP" shot "$OUT/$1.png" >/dev/null 2>&1 && { command -v magick >/dev/null 2>&1 && magick "$OUT/$1.png" -resize 1600x -strip -colors 200 "$REPO/docs/shots/$1.png" || cp "$OUT/$1.png" "$REPO/docs/shots/$1.png"; } 2>/dev/null; echo "shot $1"; }

# One space (the core answers a second or two after the socket: retried until it gives a space).
for i in $(seq 10); do "$APP" do space.new "{\"folder\":\"$H/nightjar\",\"name\":\"nightjar\"}" 2>&1 | grep -q '"space"' && break; sleep 1; done
sleep 2
# The window over the whole app: the pictures show the mod alone.
window() { do_ mod.open '{"name":"k8s"}'; sleep 2; do_ 'k8s.open:{"as":"window","full":true}'; sleep 3; }
window

# 1 the resource list: deployments, the selected one's graph in traffic order
do_ 'k8s.press:colon d e p l o y enter'
shot 1-resources 2.5
# 2 the workload graph with the keyboard (the detail panel), a pod picked
do_ 'k8s.press:tab j j j j'
shot 2-workload-graph 1
# 3 the ask before a delete (twice: the name is typed), then no
do_ 'k8s.press:escape colon p o enter ctrl-d'
shot 3-ask-delete 1
do_ 'k8s.press:y'
shot 4-ask-delete-name 1
do_ 'k8s.press:escape'
# 5 an Argo application's tree, and its diff
do_ 'k8s.show:{"view":"argo","name":"lantern"}'
do_ 'k8s.press:tab'
shot 5-argo-tree 2.5
do_ 'k8s.press:D'
shot 6-argo-diff 3
# 7 a port-forward of lantern-web: the forwards tab, then its page in a web pane
do_ 'k8s.show:{"kind":"services","name":"lantern-web","namespace":"lantern"}'
do_ 'k8s.press:F'
sleep 3
do_ 'k8s.press:f'
shot 7-forwards 1.5
do_ 'k8s.press:w'
shot 8-forward-web-pane 4
# 9 a database forward leading to Databases (when the databases mod is installed)
window
do_ 'k8s.show:{"kind":"services","name":"lantern-db","namespace":"lantern"}'
do_ 'k8s.press:F'
sleep 3
do_ 'k8s.press:f j enter'
shot 9-forward-leads 1.5
do_ 'k8s.press:b'
shot 10-forward-databases 3
# The Databases window (when that mod is installed) gives the app back before the next shots.
do_ nocturne.databases
sleep 1
# 11 a pod's logs in a pane under (the window gives way to it)
window
do_ 'k8s.press:colon p o enter l'
shot 11-logs-in-pane 3
# 12 the window as a pane (ctrl-t)
window
do_ 'k8s.press:ctrl-t'
shot 12-as-pane 3

stop
