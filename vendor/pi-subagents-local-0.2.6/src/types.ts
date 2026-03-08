/**
 * types.ts — Type definitions for the subagent system.
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export type { ThinkingLevel };

/** Built-in agent types. Custom agents use arbitrary string names. */
export type BuiltinSubagentType = "general-purpose" | "Explore" | "Plan" | "statusline-setup" | "claude-code-guide";

/** Agent type: built-in or custom (any string). */
export type SubagentType = BuiltinSubagentType | (string & {});

/** Display name mapping for built-in types. */
export const DISPLAY_NAMES: Record<BuiltinSubagentType, string> = {
  "general-purpose": "Agent",
  "Explore": "Explore",
  "Plan": "Plan",
  "statusline-setup": "Config",
  "claude-code-guide": "Guide",
};

export const SUBAGENT_TYPES: BuiltinSubagentType[] = [
  "general-purpose",
  "Explore",
  "Plan",
  "statusline-setup",
  "claude-code-guide",
];

export interface SubagentTypeConfig {
  displayName: string;
  description: string;
  builtinToolNames: string[];
  /** true = inherit all, string[] = only listed, false = none */
  extensions: true | string[] | false;
  /** true = inherit all, string[] = only listed, false = none */
  skills: true | string[] | false;
}

/** Configuration for a custom agent loaded from .pi/agents/<name>.md */
export interface CustomAgentConfig {
  name: string;
  description: string;
  builtinToolNames: string[];
  /** true = inherit all, string[] = only listed, false = none */
  extensions: true | string[] | false;
  /** true = inherit all, string[] = only listed, false = none */
  skills: true | string[] | false;
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  systemPrompt: string;
  promptMode: "replace" | "append";
  /** Default for spawn: fork parent conversation */
  inheritContext: boolean;
  /** Default for spawn: run in background */
  runInBackground: boolean;
  /** Default for spawn: no extension tools */
  isolated: boolean;
}

export type JoinMode = 'async' | 'group' | 'smart';

export interface AgentRecord {
  id: string;
  type: SubagentType;
  description: string;
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  session?: AgentSession;
  abortController?: AbortController;
  promise?: Promise<string>;
  groupId?: string;
  joinMode?: JoinMode;
  /** Set when result was already consumed via get_subagent_result — suppresses completion notification. */
  resultConsumed?: boolean;
}

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}
