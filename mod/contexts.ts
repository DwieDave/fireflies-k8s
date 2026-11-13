// The kubeconfig's contexts as `kubectl config get-contexts --no-headers`
// prints them (name, cluster, user's name, namespace; `*` on the current
// one). No credentials are read: only names. Which ones look like
// production, and which the person marked read-only (settings.ts).

/** A context the kubeconfig names. */
export interface Context {
  readonly name: string;
  readonly cluster: string;
  readonly namespace: string | null;
  readonly current: boolean;
}

/** get-contexts' lines as contexts. */
export function parseContexts(out: string): readonly Context[] {
  return out.split("\n").flatMap((line): Context[] => {
    if (!line.trim()) return [];

    const current = line.trimStart().startsWith("*");
    const f = line.replace(/^\s*\*?/, "").trim().split(/\s+/);
    const [name, cluster, , namespace] = f;

    return name ? [{ name, cluster: cluster ?? name, namespace: namespace ?? null, current }] : [];
  });
}

/** The default pattern for a production-looking context name. */
export const PROD_PATTERN = "prod|prd|production|live";

/** Whether a context's name (or its cluster's) looks like production. */
export function looksProd(ctx: Pick<Context, "name" | "cluster">, pattern: string = PROD_PATTERN): boolean {
  try {
    const re = new RegExp(`(^|[^a-z])(${pattern})([^a-z]|$)`, "i");

    return re.test(ctx.name) || re.test(ctx.cluster);
  } catch {
    return /prod/i.test(ctx.name);
  }
}
