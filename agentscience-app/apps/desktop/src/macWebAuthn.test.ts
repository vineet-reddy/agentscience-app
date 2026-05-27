import { describe, expect, it, vi } from "vitest";

import {
  configureMacWebAuthnPlatformAuthenticator,
  MAC_WEBAUTHN_KEYCHAIN_GROUP_ENV,
  MAC_WEBAUTHN_PROMPT_REASON,
  MAC_WEBAUTHN_TEAM_ID_ENV,
  resolveMacWebAuthnKeychainAccessGroup,
} from "./macWebAuthn";

describe("macWebAuthn", () => {
  it("prefers an explicit keychain access group", () => {
    expect(
      resolveMacWebAuthnKeychainAccessGroup({
        [MAC_WEBAUTHN_KEYCHAIN_GROUP_ENV]: "ABCDE12345.com.example.custom.webauthn",
        [MAC_WEBAUTHN_TEAM_ID_ENV]: "TEAMID1234",
      }),
    ).toBe("ABCDE12345.com.example.custom.webauthn");
  });

  it("derives the keychain access group from the Apple team id", () => {
    expect(
      resolveMacWebAuthnKeychainAccessGroup({
        [MAC_WEBAUTHN_TEAM_ID_ENV]: "TEAMID1234",
      }),
    ).toBe("TEAMID1234.com.agentscience.app.webauthn");
  });

  it("skips configuration off macOS", () => {
    const configureWebAuthn = vi.fn();
    const configured = configureMacWebAuthnPlatformAuthenticator({
      app: { configureWebAuthn } as never,
      platform: "linux",
      keychainAccessGroup: "TEAMID1234.com.agentscience.app.webauthn",
    });

    expect(configured).toBe(false);
    expect(configureWebAuthn).not.toHaveBeenCalled();
  });

  it("configures Electron's native Touch ID WebAuthn support on macOS", () => {
    const configureWebAuthn = vi.fn();
    const configured = configureMacWebAuthnPlatformAuthenticator({
      app: { configureWebAuthn } as never,
      platform: "darwin",
      keychainAccessGroup: "TEAMID1234.com.agentscience.app.webauthn",
    });

    expect(configured).toBe(true);
    expect(configureWebAuthn).toHaveBeenCalledWith({
      touchID: {
        keychainAccessGroup: "TEAMID1234.com.agentscience.app.webauthn",
        promptReason: MAC_WEBAUTHN_PROMPT_REASON,
      },
    });
  });
});
