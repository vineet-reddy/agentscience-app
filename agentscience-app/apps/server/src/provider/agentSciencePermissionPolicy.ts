export const AGENTSCIENCE_PERMISSION_PROFILE = "agentscience-workspace";

export type PermissionJsonRecord = Record<string, unknown>;

export type AgentSciencePermissionDecision = "allow" | "ask";

export function normalizeShellCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isWorkspaceRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("~")) return false;
  if (value.includes("\0")) return false;
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  return parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part));
}

function isWorkspaceHelperScriptPath(
  value: string,
  extensions: ReadonlySet<string>,
): boolean {
  if (!isWorkspaceRelativePath(value)) return false;
  const lower = value.toLowerCase();
  return [...extensions].some((extension) => lower.endsWith(extension));
}

export function isSafeWorkspaceHeredocWrite(command: string): boolean {
  const match = command.match(
    /^cat\s+<<\s*(['"]?)([A-Za-z0-9_-]{1,64})\1\s*>\s*([^\s;&|<>`$(){}]+)(?:\s|$)/,
  );
  if (!match) return false;
  const target = match[3];
  return (
    target !== undefined &&
    isWorkspaceHelperScriptPath(target, new Set([".py", ".js", ".mjs", ".ts", ".r"]))
  );
}

export function parseShellCommandSequence(
  value: string,
): ReadonlyArray<readonly string[]> | undefined {
  const commands: string[][] = [[]];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const finishToken = () => {
    if (token.length > 0) {
      commands[commands.length - 1]?.push(token);
      token = "";
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!char) continue;

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      if (quote === '"' && (char === "$" || char === "`")) {
        return undefined;
      }
      token += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      finishToken();
      continue;
    }

    if (char === "|" && value[index + 1] === "|") {
      finishToken();
      if ((commands.at(-1)?.length ?? 0) === 0) return undefined;
      commands.push([]);
      index += 1;
      continue;
    }

    if (";&|<>`$(){}".includes(char)) {
      return undefined;
    }

    token += char;
  }

  if (quote || escaped) return undefined;
  finishToken();
  if ((commands.at(-1)?.length ?? 0) === 0) return undefined;
  return commands;
}

export function isSafeWorkspaceLocalArgv(argv: readonly string[]): boolean {
  const executable = argv[0];
  if (!executable) return false;

  if (executable === "pwd") {
    return argv.length === 1;
  }

  if (executable === "ls") {
    return argv.slice(1).every((arg) => arg.startsWith("-") || isWorkspaceRelativePath(arg));
  }

  if (executable === "python" || executable === "python3") {
    const script = argv.find((arg, index) => index > 0 && !arg.startsWith("-"));
    return (
      script !== undefined &&
      !argv.includes("-c") &&
      !argv.includes("-m") &&
      isWorkspaceHelperScriptPath(script, new Set([".py"]))
    );
  }

  if (executable === "node") {
    const script = argv.find((arg, index) => index > 0 && !arg.startsWith("-"));
    return script !== undefined && isWorkspaceHelperScriptPath(script, new Set([".js", ".mjs"]));
  }

  if (executable === "Rscript") {
    const script = argv.find((arg, index) => index > 0 && !arg.startsWith("-"));
    return script !== undefined && isWorkspaceHelperScriptPath(script, new Set([".r"]));
  }

  return false;
}

function isManagedAgentScienceExecutable(value: string): boolean {
  return (
    value === "agentscience" ||
    value === "./.cache/agentscience/bin/agentscience" ||
    value === ".cache/agentscience/bin/agentscience"
  );
}

function consumeReadOnlyAgentScienceFlags(
  args: readonly string[],
  allowed: ReadonlySet<string>,
): boolean {
  let hasQuery = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--query" && allowed.has("--query")) {
      const value = args[index + 1];
      if (!value) return false;
      hasQuery = true;
      index += 1;
      continue;
    }
    if (arg === "--limit" && allowed.has("--limit")) {
      const value = args[index + 1];
      if (!value || !/^\d{1,4}$/.test(value)) return false;
      index += 1;
      continue;
    }
    if (arg === "--json" && allowed.has("--json")) {
      continue;
    }
    return false;
  }
  return allowed.has("--query") ? hasQuery : true;
}

export function isSafeReadOnlyAgentScienceArgv(argv: readonly string[]): boolean {
  if (!isManagedAgentScienceExecutable(argv[0] ?? "")) return false;

  const [, group, command, ...args] = argv;
  if (group === "runtime" && command === "status") {
    return args.length === 1 && args[0] === "--json";
  }
  if (group === "registry" && command === "search") {
    return consumeReadOnlyAgentScienceFlags(
      args,
      new Set(["--query", "--limit", "--json"]),
    );
  }
  if (group === "papers" && command === "list") {
    return consumeReadOnlyAgentScienceFlags(
      args,
      new Set(["--query", "--limit", "--json"]),
    );
  }
  if (group === "papers" && command === "get") {
    const [slug, ...remaining] = args;
    return (
      typeof slug === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(slug) &&
      consumeReadOnlyAgentScienceFlags(remaining, new Set(["--json"]))
    );
  }
  return false;
}

function asRecord(value: unknown): PermissionJsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as PermissionJsonRecord)
    : undefined;
}

function stringValuesFromRecord(
  record: PermissionJsonRecord | undefined,
  keys: ReadonlyArray<string>,
) {
  return keys.flatMap((key) => {
    const value = record?.[key];
    return typeof value === "string" ? [value] : [];
  });
}

export function classifyAgentScienceCommand(command: string): AgentSciencePermissionDecision {
  const normalizedCommand = normalizeShellCommand(command);
  if (isSafeWorkspaceHeredocWrite(normalizedCommand)) return "allow";
  const parsed = parseShellCommandSequence(normalizedCommand);
  const safe =
    parsed?.every(
      (argv) => isSafeReadOnlyAgentScienceArgv(argv) || isSafeWorkspaceLocalArgv(argv),
    ) ?? false;
  return safe ? "allow" : "ask";
}

export function classifyAgentSciencePermissionRequest(
  request: PermissionJsonRecord,
): AgentSciencePermissionDecision {
  const toolCall = asRecord(request.toolCall);
  if (toolCall?.kind !== "execute") {
    return "ask";
  }

  const args = asRecord(toolCall.args);
  const commandCandidates = [
    ...stringValuesFromRecord(toolCall, ["title", "command", "cmd"]),
    ...stringValuesFromRecord(args, ["command", "cmd"]),
    ...stringValuesFromRecord(request, ["command", "cmd"]),
  ];

  return commandCandidates.some(
    (command) => classifyAgentScienceCommand(command) === "allow",
  )
    ? "allow"
    : "ask";
}

export function isSafeAgentScienceInternalPermissionRequest(
  request: PermissionJsonRecord,
): boolean {
  return classifyAgentSciencePermissionRequest(request) === "allow";
}
