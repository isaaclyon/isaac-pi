/**
 * Agent dispatch extension.
 *
 * Registers `#agentname` prefix commands for every agent found in
 * `.pi/agents/` (project) and `~/.pi/agent/agents/` (global).
 *
 * Typing `#explorer find all TODOs` triggers the subagent tool
 * with that agent and prompt. Autocomplete with fuzzy matching
 * and descriptions is provided by the prefix command system.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

interface AgentInfo {
  name: string;
  description: string;
  filePath: string;
  scope: "project" | "user";
}

/** Parse YAML-style frontmatter from a markdown file. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}

/** Discover agents from a directory. */
function discoverAgents(dir: string, scope: "project" | "user"): AgentInfo[] {
  const agents: AgentInfo[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return agents;
  }
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      const name = fm["name"] ?? file.replace(/\.md$/, "");
      const description = fm["description"] ?? "";
      agents.push({ name, description, filePath, scope });
    } catch {
      // skip unreadable files
    }
  }
  return agents;
}

export default function agentDispatch(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const projectAgentsDir = resolve(cwd, ".pi/agents");
  const userAgentsDir = join(homedir(), ".pi/agent/agents");

  // Deduplicate: project agents win over user agents with the same name
  const agentMap = new Map<string, AgentInfo>();
  for (const agent of discoverAgents(userAgentsDir, "user")) {
    agentMap.set(agent.name, agent);
  }
  for (const agent of discoverAgents(projectAgentsDir, "project")) {
    agentMap.set(agent.name, agent);
  }
  const uniqueAgents = Array.from(agentMap.values());

  for (const agent of uniqueAgents) {
    const agentScope = agent.scope === "project" ? "project" : "user";

    pi.registerPrefixCommand("#", agent.name, {
      description: agent.description || `Run the ${agent.name} agent`,
      handler: async (args, _ctx) => {
        if (!args.trim()) {
          _ctx.ui.notify(`Usage: #${agent.name} <task>`, "warning");
          return;
        }
        pi.sendUserMessage(
          `Use the subagent tool to invoke the "${agent.name}" agent with agentScope "${agentScope}" and this task:\n\n${args}`,
        );
      },
    });
  }

  if (uniqueAgents.length > 0) {
    pi.on("session_start", async (_event, ctx) => {
      const names = uniqueAgents.map((a) => a.name).join(", ");
      ctx.ui.setStatus("agent-dispatch", `#agents: ${names}`);
    });
  }
}
