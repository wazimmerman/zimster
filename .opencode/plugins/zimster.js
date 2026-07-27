/**
 * Zimster adapter for OpenCode.
 * Derived from Superpowers' OpenCode bootstrap adapter (MIT License).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '../../skills');
const marker = 'zimster:using-zimster bootstrap';
let bootstrapCache;

function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function bootstrapContent() {
  if (bootstrapCache !== undefined) return bootstrapCache;
  const skillPath = path.join(skillsDir, 'using-zimster', 'SKILL.md');
  if (!fs.existsSync(skillPath)) return (bootstrapCache = null);
  const body = stripFrontmatter(fs.readFileSync(skillPath, 'utf8'));
  bootstrapCache = `<ZIMSTER_BOOTSTRAP>\n${marker}\n\n${body}\n\n## OpenCode mapping\nUse skill for skills, todowrite for tracked work, task for bounded agents, read/apply_patch/bash/grep/glob/webfetch for repository work. Subagents must not spawn subagents.\n</ZIMSTER_BOOTSTRAP>`;
  return bootstrapCache;
}

export const ZimsterPlugin = async () => ({
  config: async (config) => {
    config.skills ||= {};
    config.skills.paths ||= [];
    if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);
  },
  'experimental.chat.messages.transform': async (_input, output) => {
    const bootstrap = bootstrapContent();
    if (!bootstrap || !Array.isArray(output.messages)) return;
    const firstUser = output.messages.find((message) => message?.info?.role === 'user');
    if (!firstUser || !Array.isArray(firstUser.parts)) return;
    if (firstUser.parts.some((part) => part?.type === 'text' && part.text?.includes(marker))) return;
    const reference = firstUser.parts[0] ?? { type: 'text' };
    firstUser.parts.unshift({ ...reference, type: 'text', text: bootstrap });
  }
});
