# k8s: Kubernetes and Argo CD in Fireflies

An optional mod for [Fireflies](https://github.com/DwieDave/fireflies): your
clusters in a window (or a pane) drawn in Nocturne's night look, driven by
the keyboard first and the pointer too. Its keys follow k9s's where they fit.

![The resource list with a deployment's graph](docs/shots/1-resources.png)

## What it shows

- **Where you are**: the kubeconfig's contexts (a production-looking one
  tagged `prod`, one you marked read-only tagged `ro`), the namespaces, each
  with its pods as a strip of cells (a failing pod is a red cell, counted
  beside the name, before you open it), the kinds with their counts.
- **The kind's table**: readiness as blocks, restarts as marks (bright when
  the last one was within the hour), CPU and memory as small dithered lines
  when the cluster runs metrics-server, ages as kubectl prints them.
- **The selected row**: its graph, read the way traffic flows (ingress →
  service → deployment → replica sets → pods, old replica sets faded), each
  pod with its CPU line and restarts; describe and YAML in a read-only code
  view; its events.
- **Argo CD**: the applications (from the cluster's `applications.argoproj.io`
  objects: no `argocd` CLI needed), each one's resource tree as Argo's web UI
  draws it (out-of-sync and missing resources outlined and flagged), its
  status, history and diff; sync, refresh and rollback.
- **Port-forwards**: each one a terminal of its own that keeps running when
  the window closes, listed on a shelf with where it leads.

![An Argo CD application's tree](docs/shots/5-argo-tree.png)

## Into the rest of the app

- `l` a pod's logs and `s` a shell in it open as terminals in panes beside,
  not inside the window (a container picker when there are several).
- `F` port-forwards a pod's, service's or deployment's port. An http port
  opens in a web pane; a database's (Postgres, MySQL: guessed from the port,
  the name and the image, and you pick) opens in the Databases window when
  that mod is installed.
- `e` opens the object's YAML in the editor; when you save, the window asks
  before it applies (`kubectl replace`, so a change made meanwhile is refused,
  not overwritten).

Other mods open it on a resource: `openOverlay({ mod: "k8s", kind: "window",
key: "k8s", frame: "none", scrim: true, width: 0.88, height: 0.88, props: {
context?, namespace?, kind?, name?, view? } })`, or as a pane with
`pane.split { mod: "k8s", props: { slot, ... } }`. They find it installed by
`~/.config/herdr-app/mods/k8s/mod.json`.

## Safety

- Every write asks first, naming the context and namespace. Deleting,
  killing, draining, and anything in a context whose name looks like
  production (`prod|prd|production|live`) asks twice: the second time you
  type the object's name.
- Contexts listed as read-only in the settings are never written to.
- The window passes `--context` on every call and never changes your
  kubeconfig's current context.
- Secrets are listed by their key names only (their values never leave
  kubectl); `x` shows one secret's values on its row and forgets them when you
  leave it. They're never kept anywhere.

![The ask before a delete](docs/shots/3-ask-delete.png)

## Install

```sh
git clone <this repository> ~/code/fireflies-k8s
ln -s ~/code/fireflies-k8s/mod ~/.config/herdr-app/mods/k8s
```

Fireflies loads it at once. Open it with the palette (Kubernetes) or "+ new"
(Nocturne reads the mod's `launcher` in `mod.json`), or bind a key in your own
`~/.config/herdr-app/keys.json`:

```json
{ "global": { "cmd-shift-k": "mod.open:k8s" } }
```

To update: `git pull` in the clone; the app reloads the mod.

Settings, all optional, in `~/.config/herdr-app/k8s/settings.json`:

```json
{
  "kubectl": "kubectl",
  "readonly": ["my-prod-context"],
  "prod": "prod|prd|production|live",
  "favourites": ["my-app", "other"]
}
```

## Keys

| key | what |
|---|---|
| `:` | jump to a kind (k9s's aliases: `po`, `deploy`, `svc`, `ing`, `cm`, `sec`, `no`, `ev`, `sts`, `ds`, `cj`, `pvc`, custom kinds by name; `ctx`, `pf`, `argo`) |
| `/` | filter (`-l app=web` by label, `!x` everything but) |
| `0`-`9` | namespace (0: all; your favourites first) |
| `ctrl-a` | every kind |
| `enter` | drill in (a deployment's pods), a namespace, an app's tree |
| `g` `d` `y` `v` | graph, describe, YAML, events |
| `l` `p` `s` | logs, previous logs, shell (in panes) |
| `F` `f` | port-forward, the forwards |
| `e` | edit in the editor |
| `S` `R` | scale, restart |
| `x` | show a secret's values |
| `c` `u` `D` | cordon, uncordon, drain a node |
| `ctrl-d` `ctrl-k` | delete, kill |
| `[` `]`, `tab` | the tabs, the panels |
| `ctrl-t` | into a pane / out to a window |
| `?` | every key |

Argo CD: `S` sync, `r` refresh (`R` hard), `D` diff, `h` history, `B` roll
back to the picked revision, `o` the repository.

## Development

The mod's TypeScript meets Fireflies' bar for its own mods: strict `tsc`,
oxlint with anti-slop, a file under 750 lines and a function at 80 code
lines or fewer.

```sh
bun install
just check        # typecheck, lint, size, test (what CI runs)
just types        # refresh types/gpui-kit.d.ts from the Fireflies on PATH
```

Everything is developed and tested against `test/fake/kubectl`, a fake
kubectl answering from the recorded JSON of a made-up cluster, *nightjar*
(`test/fixtures/build.ts` writes it). Writes are logged, never applied.
`test/shots.sh <herdr-app>` takes the pictures above in a scratch Fireflies.

Icons: [Lucide](https://lucide.dev) (ISC).
