/** Zimster Pi adapter, adapted from Superpowers v6.2.0 (MIT). */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const marker = "zimster:using-zimster bootstrap for pi";
const extensionDir = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(extensionDir, "../..", "skills", "using-zimster", "SKILL.md");
let cached: string | undefined;

export default function zimsterPiExtension(pi: ExtensionAPI) {
  getBootstrap();
  let inject = true;
  pi.on("session_start", async () => { inject = true; });
  pi.on("session_compact", async () => { inject = true; });
  pi.on("agent_end", async () => { inject = false; });
  pi.on("context", async (event) => {
    if (!inject || event.messages.some(containsMarker)) return;
    const text = getBootstrap();
    const message = { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() };
    let index = 0;
    while ((event.messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") index += 1;
    return { messages: [...event.messages.slice(0, index), message, ...event.messages.slice(index)] };
  });
}

function getBootstrap(): string {
  if (cached !== undefined) return cached;
  cached = loadZimsterBootstrap();
  return cached;
}

export function loadZimsterBootstrap(file = skillPath): string {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`ZIMSTER_PACKAGE_INVALID: missing required using-zimster skill at ${file}`);
  }
  const body = (raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? raw).trim();
  return `<ZIMSTER_BOOTSTRAP>\n${marker}\n\n${body}\n\n## Pi mapping\nUse native skills and read/write/edit/bash tools. Zimster ships no Pi subagent runtime, so execute owner-inline by default. An external extension may consume a selected proposal but is neither installed nor trusted by Zimster. Subagents must not spawn subagents.\n</ZIMSTER_BOOTSTRAP>`;
}

function containsMarker(message: unknown): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.includes(marker);
  return Array.isArray(content) && content.some((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" && String((part as { text?: unknown }).text ?? "").includes(marker));
}
