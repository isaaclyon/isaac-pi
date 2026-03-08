/**
 * agent-types.ts — Agent type registry: tool sets and configs per subagent type.
 *
 * Supports both built-in types and custom agents loaded from .pi/agents/*.md.
 */

import {
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { BuiltinSubagentType, SubagentType, SubagentTypeConfig, CustomAgentConfig } from "./types.js";

type ToolFactory = (cwd: string) => AgentTool<any>;

const TOOL_FACTORIES: Record<string, ToolFactory> = {
  read: (cwd) => createReadTool(cwd),
  bash: (cwd) => createBashTool(cwd),
  edit: (cwd) => createEditTool(cwd),
  write: (cwd) => createWriteTool(cwd),
  grep: (cwd) => createGrepTool(cwd),
  find: (cwd) => createFindTool(cwd),
  ls: (cwd) => createLsTool(cwd),
};

/** All known built-in tool names, derived from the factory registry. */
export const BUILTIN_TOOL_NAMES = Object.keys(TOOL_FACTORIES);

const BUILTIN_CONFIGS: Record<BuiltinSubagentType, SubagentTypeConfig> = {
  "general-purpose": {
    displayName: "Agent",
    description: "General-purpose agent for complex, multi-step tasks",
    builtinToolNames: BUILTIN_TOOL_NAMES,
    extensions: true,
    skills: true,
  },
  "Explore": {
    displayName: "Explore",
    description: "Fast codebase exploration agent (read-only)",
    builtinToolNames: ["read", "bash", "grep", "find", "ls"],
    extensions: true,
    skills: true,
  },
  "Plan": {
    displayName: "Plan",
    description: "Software architect for implementation planning (read-only)",
    builtinToolNames: ["read", "bash", "grep", "find", "ls"],
    extensions: true,
    skills: true,
  },
  "statusline-setup": {
    displayName: "Config",
    description: "Configuration editor (read + edit only)",
    builtinToolNames: ["read", "edit"],
    extensions: false,
    skills: false,
  },
  "claude-code-guide": {
    displayName: "Guide",
    description: "Documentation and help queries",
    builtinToolNames: ["read", "grep", "find"],
    extensions: false,
    skills: false,
  },
};

/** Runtime registry of custom agent configs. */
const customAgents = new Map<string, CustomAgentConfig>();
const hiddenBuiltinTypes = new Set<BuiltinSubagentType>();

function getBuiltinTypeNames(): BuiltinSubagentType[] {
  return Object.keys(BUILTIN_CONFIGS) as BuiltinSubagentType[];
}

export function setHiddenBuiltinTypes(types: BuiltinSubagentType[]): void {
  hiddenBuiltinTypes.clear();
  for (const type of types) {
    if (type in BUILTIN_CONFIGS) hiddenBuiltinTypes.add(type);
  }
}

export function isHiddenBuiltinType(type: string): boolean {
  return hiddenBuiltinTypes.has(type as BuiltinSubagentType);
}

export function getVisibleBuiltinTypes(): BuiltinSubagentType[] {
  return getBuiltinTypeNames().filter((type) => !hiddenBuiltinTypes.has(type));
}

/** Register custom agents into the runtime registry. */
export function registerCustomAgents(agents: Map<string, CustomAgentConfig>): void {
  customAgents.clear();
  for (const [name, config] of agents) {
    customAgents.set(name, config);
  }
}

/** Get the custom agent config if it exists. */
export function getCustomAgentConfig(name: string): CustomAgentConfig | undefined {
  return customAgents.get(name);
}

/** Get all available type names (built-in + custom). */
export function getAvailableTypes(): string[] {
  return [...getVisibleBuiltinTypes(), ...customAgents.keys()];
}

/** Get all custom agent names. */
export function getCustomAgentNames(): string[] {
  return [...customAgents.keys()];
}

/** Check if a type is valid (built-in or custom). */
export function isValidType(type: string): boolean {
  if (type in BUILTIN_CONFIGS) return !isHiddenBuiltinType(type);
  return customAgents.has(type);
}

/** Get built-in tools for a type. Works for both built-in and custom agents. */
export function getToolsForType(type: SubagentType, cwd: string): AgentTool<any>[] {
  const config = BUILTIN_CONFIGS[type as BuiltinSubagentType];
  if (config) {
    return config.builtinToolNames.map((n) => TOOL_FACTORIES[n](cwd));
  }
  const custom = customAgents.get(type);
  if (custom) {
    return custom.builtinToolNames
      .filter((n) => n in TOOL_FACTORIES)
      .map((n) => TOOL_FACTORIES[n](cwd));
  }
  // Fallback: all tools
  return BUILTIN_TOOL_NAMES.map((n) => TOOL_FACTORIES[n](cwd));
}

/** Get config for a type. Works for both built-in and custom agents. */
export function getConfig(type: SubagentType): SubagentTypeConfig {
  const builtin = BUILTIN_CONFIGS[type as BuiltinSubagentType];
  if (builtin) return builtin;

  const custom = customAgents.get(type);
  if (custom) {
    return {
      displayName: custom.name,
      description: custom.description,
      builtinToolNames: custom.builtinToolNames,
      extensions: custom.extensions,
      skills: custom.skills,
    };
  }

  // Fallback for unknown types — general-purpose config
  return BUILTIN_CONFIGS["general-purpose"];
}
