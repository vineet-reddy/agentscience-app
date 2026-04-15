import type {
  CodexAuthApiKeyLoginInput,
  CodexAuthCancelLoginInput,
  CodexAuthError,
  CodexAuthState,
} from "@agentscience/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface CodexAuthShape {
  readonly getState: Effect.Effect<CodexAuthState, CodexAuthError>;
  readonly startChatgptLogin: Effect.Effect<CodexAuthState, CodexAuthError>;
  readonly loginWithApiKey: (
    input: CodexAuthApiKeyLoginInput,
  ) => Effect.Effect<CodexAuthState, CodexAuthError>;
  readonly cancelChatgptLogin: (
    input?: CodexAuthCancelLoginInput,
  ) => Effect.Effect<CodexAuthState, CodexAuthError>;
  readonly logout: Effect.Effect<CodexAuthState, CodexAuthError>;
}

export class CodexAuth extends ServiceMap.Service<CodexAuth, CodexAuthShape>()(
  "agentscience/provider/Services/CodexAuth",
) {}
