// The fake kubectl as the mod's Exec (kubectl.ts): runs test/fake/kubectl with
// the arguments the mod builds, against the made-up cluster.
import { join } from "node:path";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

export const KUBECTL = join(import.meta.dir, "..", "fake", "kubectl");

/** A fresh write log for one test file. */
export function writeLog(): string {
  return join(mkdtempSync(join(tmpdir(), "k8s-fake-")), "writes.log");
}

/** The writes the fake recorded (each its argv). */
export function writes(log: string): string[][] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).argv);
}

export function fakeExec(env: Record<string, string> = {}) {
  return async (args: readonly string[], _timeout: number) => {
    const p = Bun.spawn([KUBECTL, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, stdout, stderr };
  };
}
