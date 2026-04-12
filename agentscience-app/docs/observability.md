# Observability

This doc is for engineers who want to figure out why the server did something, or why it did it slowly.

The short version: the server writes every completed span to a local NDJSON file, and that file is the thing you actually read. Logs go to stdout for humans. Metrics stay in-process unless you turn on OTLP export. So if you need to debug one request, you open the trace file. If you need to watch trends over time, you wire up OTLP and look at Grafana.

Before drilling into any of that, keep the shape in your head:

- logs: stdout, not persisted
- traces: local NDJSON file, always on, optionally also exported over OTLP
- metrics: in-process, not persisted locally, optionally exported over OTLP

The trace file is the important one. Everything else is either ephemeral (logs) or needs a real backend to see anything (metrics).

## Where things live

All of the wiring is in one small file so you can read it top to bottom:

- [Observability.ts](../apps/server/src/observability/Layers/Observability.ts) builds the tracer layer, attaches OTLP if configured, and is the single entry point
- [LocalFileTracer.ts](../apps/server/src/observability/LocalFileTracer.ts) is the tracer implementation that writes finished spans to disk
- [TraceSink.ts](../apps/server/src/observability/TraceSink.ts) handles batching and file rotation
- [TraceRecord.ts](../apps/server/src/observability/TraceRecord.ts) is the on-disk schema for a single span line
- [Metrics.ts](../apps/server/src/observability/Metrics.ts) defines every counter and timer the server uses
- [RpcInstrumentation.ts](../apps/server/src/observability/RpcInstrumentation.ts) wraps RPC request handling so every websocket call becomes a span and a metric point

If you want to understand the whole observability story in twenty minutes, read those files in that order.

## The trace file

Each line in `server.trace.ndjson` is one completed span. The fields that matter most when you are debugging:

- `name`: span name, for example `sql.execute`, `git.runCommand`, `provider.sendTurn`
- `traceId`, `spanId`, `parentSpanId`: how spans tie together into a trace tree
- `durationMs`: elapsed wall-clock time
- `attributes`: structured context like IDs, paths, command type
- `events`: embedded log lines and custom events that happened inside the span
- `exit`: one of `Success`, `Failure`, or `Interrupted`

The file lives at `serverTracePath`, which defaults to `~/.agentscience/userdata/logs/server.trace.ndjson`. In monorepo dev, it lands under `./dev/logs/server.trace.ndjson` because the dev runner overrides `AGENTSCIENCE_HOME`.

Logs emitted inside an active span (for ex. `Effect.logInfo("starting turn")`) show up as span events in the trace record, because `Logger.tracerLogger` is installed in the server logger layer. Logs emitted outside a span are only visible on stdout, they are not persisted anywhere.

## Running with just the local trace file

This is the default. You do not need any env vars. Run the server or the desktop app the normal way and `server.trace.ndjson` starts filling up:

```bash
bun dev:server
```

```bash
bun dev
```

```bash
bun dev:desktop
```

Then tail the file in another shell:

```bash
tail -f "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

In monorepo dev:

```bash
tail -f ./dev/logs/server.trace.ndjson
```

Most of the time this is all you need. The local file is usually enough to understand one bad request, because `jq` lets you slice it however you want.

## Useful jq queries

These are the ones that come up over and over. Worth pinning somewhere.

Failures only:

```bash
jq -c 'select(.exit._tag != "Success") | { name, durationMs, exit, attributes }' \
  "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Slow spans (over one second):

```bash
jq -c 'select(.durationMs > 1000) | { name, durationMs, traceId, spanId }' \
  "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Embedded log events on each span:

```bash
jq -c 'select(any(.events[]?; .attributes["effect.logLevel"] != null)) | {
  name,
  durationMs,
  events: [.events[]
    | select(.attributes["effect.logLevel"] != null)
    | { message: .name, level: .attributes["effect.logLevel"] }]
}' "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Follow one full trace by id:

```bash
jq -r 'select(.traceId == "TRACE_ID_HERE")
  | [.name, .spanId, (.parentSpanId // "-"), .durationMs] | @tsv' \
  "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Filter to orchestration commands:

```bash
jq -c 'select(.attributes["orchestration.command_type"] != null) | {
  name,
  durationMs,
  commandType: .attributes["orchestration.command_type"],
  aggregateKind: .attributes["orchestration.aggregate_kind"]
}' "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Filter to git commands and their hook events:

```bash
jq -c 'select(.attributes["git.operation"] != null) | {
  name,
  durationMs,
  operation: .attributes["git.operation"],
  cwd: .attributes["git.cwd"],
  hookEvents: [.events[] | select(.name == "git.hook.started" or .name == "git.hook.finished")]
}' "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

## Running with a real OTLP backend

When the NDJSON file plus jq stops being enough, switch to a proper trace viewer. The easiest path is running Grafana LGTM locally in docker, pointing the server at it with a couple of env vars. That gives you Tempo for traces, Prometheus for metrics, and Grafana as the UI.

### 1. Start Grafana LGTM

```bash
docker run --name lgtm \
  -p 3000:3000 \
  -p 4317:4317 \
  -p 4318:4318 \
  --rm -ti \
  grafana/otel-lgtm
```

Open `http://localhost:3000`. Default login is `admin` / `admin`.

### 2. Set OTLP env vars

```bash
export AGENTSCIENCE_OTLP_TRACES_URL=http://localhost:4318/v1/traces
export AGENTSCIENCE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics
export AGENTSCIENCE_OTLP_SERVICE_NAME=agentscience-local
```

### 3. Launch the app from that same shell

So the env vars actually reach the backend. For CLI or monorepo dev this is obvious. For the packaged desktop app you have to launch the binary itself, not click the icon, or the shell env never gets inherited:

macOS bundle:

```bash
AGENTSCIENCE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
AGENTSCIENCE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
AGENTSCIENCE_OTLP_SERVICE_NAME=agentscience-desktop \
"/Applications/Agent Science.app/Contents/MacOS/Agent Science"
```

Launching from Finder, Spotlight, the dock, or the Start menu will not pick up shell env vars. That is the single most common reason "I set the env vars but nothing shows up in Grafana".

### 4. Restart fully after changing env

The backend reads observability config at process start. Changing env mid-session does nothing. Stop the app completely, then start it again.

## Env vars

Everything here is read once at startup. Changing one requires a full restart.

Local trace file:

- `AGENTSCIENCE_TRACE_FILE`: override trace file path
- `AGENTSCIENCE_TRACE_MAX_BYTES`: per-file rotation size, default `10485760` (10 MiB)
- `AGENTSCIENCE_TRACE_MAX_FILES`: how many rotated files to keep, default `10`
- `AGENTSCIENCE_TRACE_BATCH_WINDOW_MS`: flush window for batching span writes, default `200`
- `AGENTSCIENCE_TRACE_MIN_LEVEL`: minimum trace level, default `Info`
- `AGENTSCIENCE_TRACE_TIMING_ENABLED`: enable timing metadata, default `true`

OTLP export:

- `AGENTSCIENCE_OTLP_TRACES_URL`: OTLP trace endpoint, unset means no export
- `AGENTSCIENCE_OTLP_METRICS_URL`: OTLP metrics endpoint, unset means no export
- `AGENTSCIENCE_OTLP_EXPORT_INTERVAL_MS`: export interval, default `10000`
- `AGENTSCIENCE_OTLP_SERVICE_NAME`: service name attached to exported data, default `agentscience-server`

If both OTLP URLs are unset the local trace file still works and metrics stay in-process.

## What is instrumented right now

You do not need to memorize every span name, but you should know the boundaries that exist, because these are the seams where performance issues usually show up:

- websocket RPC request handling (via Effect RPC)
- orchestration command dispatch
- orchestration command ack latency (the metric below)
- provider sessions and turns
- git commands plus embedded git hook events
- terminal session lifecycle
- sqlite query execution
- server startup phases

If the app feels slow, one of these boundaries is usually enough to tell you whether the slowdown is in RPC, orchestration, providers, git, terminal, or the database. That is why they exist where they do.

## The one metric worth knowing by name

`t3_orchestration_command_ack_duration`

It measures the time between a command entering the orchestration engine and the first committed domain event for that command being published by the server. Put plainly, how long the backend took to accept and commit the command.

What it does not measure: websocket transit to the browser, browser receipt, React render. So if someone says "rename feels slow" or "move feels slow", this metric answers the backend half of that question. If the metric is fine and the UI still feels slow, the slowness is on the wire or in the client, not in the engine.

## Common debugging workflows

### "Why did this one request fail?"

1. Open the local NDJSON file
2. Filter for spans where `exit._tag != "Success"`
3. Group by `traceId` and read the sibling spans plus their events
4. If the trace tree is complicated, pull it up in Tempo in Grafana instead

### "Why does the UI feel slow?"

1. Start with slow top-level spans in the trace file or in Tempo
2. Look at children for sqlite, git, provider, or terminal work
3. Cross-check with the matching duration metrics to see if this is a one-off or a trend

### "Is a specific command type slow or failing a lot?"

1. Check `t3_orchestration_command_ack_duration` grouped by `commandType`
2. If it is high, pull the corresponding orchestration trace
3. Read the children for projection, sqlite, provider, or git work

### "Are git hooks causing latency?"

1. Filter trace records to spans with a `git.operation` attribute
2. Inspect `git.hook.started` and `git.hook.finished` events inside them
3. Compare hook time to total git span duration

### "I have spans locally but nothing in Grafana"

In almost every case this is one of:

- `AGENTSCIENCE_OTLP_TRACES_URL` was never actually set in the process that is running the server
- the app was launched from a different environment than the one where you exported the vars (ie. Finder vs terminal)
- the app was not fully restarted after changing env
- Grafana is looking at the wrong time range or a different service name

If the local NDJSON file is still updating, local tracing is fine and the problem is OTLP export or process startup.

## Adding instrumentation to new code

Keep it boring. Good span boundaries are usually the seams between subsystems, not every tiny helper:

- RPC methods
- orchestration command handling
- provider adapter calls
- external process calls
- persistence writes
- queue handoffs

Most helpers should inherit the active span rather than create new ones. If you create a span for every three-line function you will drown in noise.

### Effect.fn is the default boundary

The codebase already uses `Effect.fn("name")` extensively. That is usually your first tracing boundary, and it is almost always enough. For ad hoc spans:

```ts
import { Effect } from "effect";

const runThing = Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan({
    "thing.id": "abc123",
    "thing.kind": "example",
  });
  yield* Effect.logInfo("starting thing");
  return yield* doWork();
}).pipe(Effect.withSpan("thing.run"));
```

### Detail goes on spans, labels go on metrics

High-cardinality context like IDs, paths, full prompts, cwds, belongs on span attributes. Never on metric labels. Metric labels must stay low cardinality or you will blow up the metric store.

Good metric labels:

- operation kind
- method name
- provider kind
- aggregate kind
- outcome

Bad metric labels:

- raw thread IDs or command IDs
- file paths or cwd
- full prompts or full model strings when a normalized family label would do

### Logs inside spans become span events

Any `Effect.log*` call inside an active span lands as a span event because `Logger.tracerLogger` is installed:

```ts
yield* Effect.logInfo("starting provider turn");
yield* Effect.logDebug("waiting for approval response");
```

That is how you get a running commentary inside a trace record without inventing custom events.

### The pipeable metrics API

`withMetrics` is the default way to attach a counter and timer to an effect in one shot:

```ts
import { someCounter, someDuration, withMetrics } from "../observability/Metrics.ts";

const program = doWork().pipe(
  withMetrics({
    counter: someCounter,
    timer: someDuration,
    attributes: { operation: "work" },
  }),
);
```

It reads `Exit` automatically, so the counter gets an `outcome` label (success, failure, interrupt) for free.

## Practical rules of thumb

- debugging one bad request, reach for traces
- asking whether something is broadly slow or broadly failing, reach for metrics
- adding new instrumentation, add a trace span first, and only add a metric if there is a recurring question that metric is meant to answer
- if in doubt, look at the local trace file before anything else

## Current limits

A few things to keep in mind so you do not chase missing data:

- logs outside of spans are not persisted anywhere, only stdout
- metrics are not snapshotted locally, if OTLP export is off you get nothing historical
- the old `serverLogPath` field in config still exists for compatibility but the trace file is the artifact that actually matters now
