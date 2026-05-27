import type { App } from "electron";

export const MAC_WEBAUTHN_KEYCHAIN_GROUP_ENV = "AGENTSCIENCE_MAC_WEBAUTHN_KEYCHAIN_ACCESS_GROUP";
export const MAC_WEBAUTHN_TEAM_ID_ENV = "AGENTSCIENCE_MAC_TEAM_ID";
export const MAC_WEBAUTHN_KEYCHAIN_GROUP_SUFFIX = "com.agentscience.app.webauthn";
export const MAC_WEBAUTHN_PROMPT_REASON = "sign in to $1";

export function resolveMacWebAuthnKeychainAccessGroup(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const explicitGroup = env[MAC_WEBAUTHN_KEYCHAIN_GROUP_ENV]?.trim();
  if (explicitGroup) {
    return explicitGroup;
  }

  const teamId = env[MAC_WEBAUTHN_TEAM_ID_ENV]?.trim();
  return teamId ? `${teamId}.${MAC_WEBAUTHN_KEYCHAIN_GROUP_SUFFIX}` : undefined;
}

export function configureMacWebAuthnPlatformAuthenticator(input: {
  readonly app: App;
  readonly platform: NodeJS.Platform;
  readonly keychainAccessGroup: string | undefined;
  readonly log?: (message: string) => void;
}): boolean {
  if (input.platform !== "darwin") {
    return false;
  }
  if (!input.keychainAccessGroup) {
    input.log?.(
      `macOS WebAuthn Touch ID disabled: set ${MAC_WEBAUTHN_KEYCHAIN_GROUP_ENV} or ${MAC_WEBAUTHN_TEAM_ID_ENV}.`,
    );
    return false;
  }
  if (typeof input.app.configureWebAuthn !== "function") {
    input.log?.("macOS WebAuthn Touch ID disabled: Electron runtime does not expose configureWebAuthn.");
    return false;
  }

  try {
    input.app.configureWebAuthn({
      touchID: {
        keychainAccessGroup: input.keychainAccessGroup,
        promptReason: MAC_WEBAUTHN_PROMPT_REASON,
      },
    });
    input.log?.(`macOS WebAuthn Touch ID enabled for ${input.keychainAccessGroup}.`);
    return true;
  } catch (error) {
    input.log?.(
      `macOS WebAuthn Touch ID setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
