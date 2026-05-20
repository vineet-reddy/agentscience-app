import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { LocalPaperSummary } from "./localPapers";

export const DEEP_LINKS_ROUTE_PREFIX = "/api/deep-links";

export function deepLinkPaperOpenRoutePath(): string {
  return `${DEEP_LINKS_ROUTE_PREFIX}/paper/open`;
}

export const DeepLinkPaperOpenRequest = Schema.Struct({
  slug: TrimmedNonEmptyString,
  baseUrl: TrimmedNonEmptyString,
});
export type DeepLinkPaperOpenRequest = typeof DeepLinkPaperOpenRequest.Type;

export const DeepLinkPaperOpenResponse = Schema.Struct({
  status: Schema.Union([
    Schema.Literal("opened"),
    Schema.Literal("auth-required"),
    Schema.Literal("not-local"),
    Schema.Literal("not-found"),
  ]),
  slug: TrimmedNonEmptyString,
  baseUrl: TrimmedNonEmptyString,
  paper: Schema.NullOr(LocalPaperSummary),
  remoteTitle: Schema.NullOr(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
});
export type DeepLinkPaperOpenResponse = typeof DeepLinkPaperOpenResponse.Type;
