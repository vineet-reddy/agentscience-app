import os from "node:os";
import path from "node:path";

export const PAPERS_DIRNAME = "Papers";
export const AGENTS_DIRNAME = "Agents";
export const PROJECTS_DIRNAME = "Projects";
export const PROJECT_PAPERS_DIRNAME = "papers";
export const PROJECT_AGENTS_DIRNAME = "agents";

function expandHomePath(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function normalizeWorkspacePath(input: string): string {
  return path.resolve(expandHomePath(input.trim()));
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  const normalizedCandidate = normalizeWorkspacePath(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return (
    relative.length === 0 ||
    relative === "." ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function isContainerWorkspaceRoot(containerRoot: string, candidatePath: string): boolean {
  const normalizedContainerRoot = normalizeWorkspacePath(containerRoot);
  const normalizedCandidatePath = normalizeWorkspacePath(candidatePath);
  return (
    normalizedCandidatePath === normalizedContainerRoot ||
    normalizedCandidatePath === path.join(normalizedContainerRoot, PAPERS_DIRNAME) ||
    normalizedCandidatePath === path.join(normalizedContainerRoot, AGENTS_DIRNAME) ||
    normalizedCandidatePath === path.join(normalizedContainerRoot, PROJECTS_DIRNAME)
  );
}

export function resolveManagedProjectWorkspaceRoot(
  containerRoot: string,
  folderSlug: string,
): string {
  return path.join(normalizeWorkspacePath(containerRoot), PROJECTS_DIRNAME, folderSlug);
}

export function resolveManagedPaperWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly projectWorkspaceRoot: string | null;
  readonly folderSlug: string;
}): string {
  return input.projectWorkspaceRoot === null
    ? path.join(normalizeWorkspacePath(input.containerRoot), PAPERS_DIRNAME, input.folderSlug)
    : path.join(
        normalizeWorkspacePath(input.projectWorkspaceRoot),
        PROJECT_PAPERS_DIRNAME,
        input.folderSlug,
      );
}

export function resolveManagedAgentWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly projectWorkspaceRoot: string | null;
  readonly folderSlug: string;
}): string {
  return input.projectWorkspaceRoot === null
    ? path.join(normalizeWorkspacePath(input.containerRoot), AGENTS_DIRNAME, input.folderSlug)
    : path.join(
        normalizeWorkspacePath(input.projectWorkspaceRoot),
        PROJECT_AGENTS_DIRNAME,
        input.folderSlug,
      );
}

export function validateProjectWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly projectWorkspaceRoot: string;
}):
  | { readonly ok: true; readonly workspaceRoot: string }
  | { readonly ok: false; readonly workspaceRoot: string; readonly detail: string } {
  const normalizedContainerRoot = normalizeWorkspacePath(input.containerRoot);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(input.projectWorkspaceRoot);
  const projectsRoot = path.join(normalizedContainerRoot, PROJECTS_DIRNAME);
  if (isContainerWorkspaceRoot(input.containerRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Project workspace root cannot be the global workspace container.",
    };
  }
  if (!isPathWithinRoot(projectsRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Project workspace root must stay inside the managed Projects container.",
    };
  }
  if (path.dirname(normalizedWorkspaceRoot) !== projectsRoot) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Project workspace root must be a direct child of the managed Projects container.",
    };
  }
  return {
    ok: true,
    workspaceRoot: normalizedWorkspaceRoot,
  };
}

export function getValidatedProjectWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly projectWorkspaceRoot: string;
}): string | null {
  const validation = validateProjectWorkspaceRoot(input);
  return validation.ok ? validation.workspaceRoot : null;
}

export function validatePaperWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly paperWorkspaceRoot: string;
  readonly projectWorkspaceRoot?: string | null;
}):
  | { readonly ok: true; readonly workspaceRoot: string }
  | { readonly ok: false; readonly workspaceRoot: string; readonly detail: string } {
  const normalizedContainerRoot = normalizeWorkspacePath(input.containerRoot);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(input.paperWorkspaceRoot);
  const unmanagedPapersRoot = path.join(normalizedContainerRoot, PAPERS_DIRNAME);
  if (isContainerWorkspaceRoot(input.containerRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Paper workspace root cannot be the global workspace container.",
    };
  }
  if (
    input.projectWorkspaceRoot !== undefined &&
    input.projectWorkspaceRoot !== null &&
    normalizedWorkspaceRoot === normalizeWorkspacePath(input.projectWorkspaceRoot)
  ) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Paper workspace root cannot be the same directory as its parent project root.",
    };
  }
  if (input.projectWorkspaceRoot === undefined || input.projectWorkspaceRoot === null) {
    if (!isPathWithinRoot(unmanagedPapersRoot, normalizedWorkspaceRoot)) {
      return {
        ok: false,
        workspaceRoot: normalizedWorkspaceRoot,
        detail: "Unassigned paper workspace root must stay inside the managed Papers container.",
      };
    }
    if (path.dirname(normalizedWorkspaceRoot) !== unmanagedPapersRoot) {
      return {
        ok: false,
        workspaceRoot: normalizedWorkspaceRoot,
        detail:
          "Unassigned paper workspace root must be a direct child of the managed Papers container.",
      };
    }
    return {
      ok: true,
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const normalizedProjectWorkspaceRoot = normalizeWorkspacePath(input.projectWorkspaceRoot);
  const projectValidation = validateProjectWorkspaceRoot({
    containerRoot: normalizedContainerRoot,
    projectWorkspaceRoot: normalizedProjectWorkspaceRoot,
  });
  if (!projectValidation.ok) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: `Paper workspace root must belong to a valid managed project workspace: ${projectValidation.detail}`,
    };
  }
  const managedProjectPapersRoot = path.join(
    normalizedProjectWorkspaceRoot,
    PROJECT_PAPERS_DIRNAME,
  );
  if (!isPathWithinRoot(managedProjectPapersRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Project paper workspace root must stay inside the managed project papers container.",
    };
  }
  if (path.dirname(normalizedWorkspaceRoot) !== managedProjectPapersRoot) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail:
        "Project paper workspace root must be a direct child of the managed project papers container.",
    };
  }
  return {
    ok: true,
    workspaceRoot: normalizedWorkspaceRoot,
  };
}

export function validateAgentWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly agentWorkspaceRoot: string;
  readonly projectWorkspaceRoot?: string | null;
}):
  | { readonly ok: true; readonly workspaceRoot: string }
  | { readonly ok: false; readonly workspaceRoot: string; readonly detail: string } {
  const normalizedContainerRoot = normalizeWorkspacePath(input.containerRoot);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(input.agentWorkspaceRoot);
  const unmanagedAgentsRoot = path.join(normalizedContainerRoot, AGENTS_DIRNAME);
  if (isContainerWorkspaceRoot(input.containerRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Agent workspace root cannot be the global workspace container.",
    };
  }
  if (
    input.projectWorkspaceRoot !== undefined &&
    input.projectWorkspaceRoot !== null &&
    normalizedWorkspaceRoot === normalizeWorkspacePath(input.projectWorkspaceRoot)
  ) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Agent workspace root cannot be the same directory as its parent project root.",
    };
  }
  if (input.projectWorkspaceRoot === undefined || input.projectWorkspaceRoot === null) {
    if (!isPathWithinRoot(unmanagedAgentsRoot, normalizedWorkspaceRoot)) {
      return {
        ok: false,
        workspaceRoot: normalizedWorkspaceRoot,
        detail: "Unassigned agent workspace root must stay inside the managed Agents container.",
      };
    }
    if (path.dirname(normalizedWorkspaceRoot) !== unmanagedAgentsRoot) {
      return {
        ok: false,
        workspaceRoot: normalizedWorkspaceRoot,
        detail:
          "Unassigned agent workspace root must be a direct child of the managed Agents container.",
      };
    }
    return {
      ok: true,
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const normalizedProjectWorkspaceRoot = normalizeWorkspacePath(input.projectWorkspaceRoot);
  const projectValidation = validateProjectWorkspaceRoot({
    containerRoot: normalizedContainerRoot,
    projectWorkspaceRoot: normalizedProjectWorkspaceRoot,
  });
  if (!projectValidation.ok) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: `Agent workspace root must belong to a valid managed project workspace: ${projectValidation.detail}`,
    };
  }
  const managedProjectAgentsRoot = path.join(
    normalizedProjectWorkspaceRoot,
    PROJECT_AGENTS_DIRNAME,
  );
  if (!isPathWithinRoot(managedProjectAgentsRoot, normalizedWorkspaceRoot)) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail: "Project agent workspace root must stay inside the managed project agents container.",
    };
  }
  if (path.dirname(normalizedWorkspaceRoot) !== managedProjectAgentsRoot) {
    return {
      ok: false,
      workspaceRoot: normalizedWorkspaceRoot,
      detail:
        "Project agent workspace root must be a direct child of the managed project agents container.",
    };
  }
  return {
    ok: true,
    workspaceRoot: normalizedWorkspaceRoot,
  };
}

export function getValidatedAgentWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly agentWorkspaceRoot: string;
  readonly projectWorkspaceRoot?: string | null;
}): string | null {
  const validation = validateAgentWorkspaceRoot(input);
  return validation.ok ? validation.workspaceRoot : null;
}

export function getValidatedPaperWorkspaceRoot(input: {
  readonly containerRoot: string;
  readonly paperWorkspaceRoot: string;
  readonly projectWorkspaceRoot?: string | null;
}): string | null {
  const validation = validatePaperWorkspaceRoot(input);
  return validation.ok ? validation.workspaceRoot : null;
}

export function rebaseWorkspaceRoot(input: {
  readonly workspaceRoot: string;
  readonly fromContainerRoot: string;
  readonly toContainerRoot: string;
}): string | null {
  if (!isPathWithinRoot(input.fromContainerRoot, input.workspaceRoot)) {
    return null;
  }
  const normalizedFromContainerRoot = normalizeWorkspacePath(input.fromContainerRoot);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(input.workspaceRoot);
  const normalizedToContainerRoot = normalizeWorkspacePath(input.toContainerRoot);
  const relative = path.relative(normalizedFromContainerRoot, normalizedWorkspaceRoot);
  return relative.length === 0 || relative === "."
    ? normalizedToContainerRoot
    : path.join(normalizedToContainerRoot, relative);
}
