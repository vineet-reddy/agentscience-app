# Observability

This is the short version.

AgentScience keeps observability simple:

- logs go to stdout
- completed spans go to a local NDJSON trace file
- traces and metrics can also be exported over OTLP if you want Grafana or another backend

The local trace file is the main persisted artifact.

## The model

Think about observability in three buckets.

### Logs

Human-facing only.

- destination: stdout
- persistence: none

### Traces

This is the important persisted record.

- destination: local NDJSON file
- default file: `server.trace.ndjson`
- also exportable over OTLP

Each line is one completed span with timing, attributes, events, and exit status.

### Metrics

Metrics are in-process by default.

- local file: none
- remote export: OTLP only

So if you want historical metrics, you need a real backend.

## Where to look in code

- wiring: [Observability.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/observability/Layers/Observability.ts)
- metrics: [Metrics.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/observability/Metrics.ts)
- RPC metrics: [RpcInstrumentation.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/observability/RpcInstrumentation.ts)
- trace record schema: [TraceRecord.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/observability/TraceRecord.ts)

## Most common workflow

Start local first.

Run the app, then inspect the local trace file.

Useful commands:

```bash
tail -f "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

In monorepo dev:

```bash
tail -f ./dev/logs/server.trace.ndjson
```

Show failures:

```bash
jq -c 'select(.exit._tag != "Success") | { name, durationMs, exit, attributes }' \
  "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

Show slow spans:

```bash
jq -c 'select(.durationMs > 1000) | { name, durationMs, traceId, spanId }' \
  "$AGENTSCIENCE_HOME/userdata/logs/server.trace.ndjson"
```

## OTLP mode

If you want Grafana, Tempo, Prometheus, or an OTLP-compatible backend, set the OTLP env vars and restart the app.

Important env vars:

- `AGENTSCIENCE_OTLP_TRACES_URL`
- `AGENTSCIENCE_OTLP_METRICS_URL`
- `AGENTSCIENCE_OTLP_SERVICE_NAME`

Local trace settings:

- `AGENTSCIENCE_TRACE_FILE`
- `AGENTSCIENCE_TRACE_MAX_BYTES`
- `AGENTSCIENCE_TRACE_MAX_FILES`
- `AGENTSCIENCE_TRACE_BATCH_WINDOW_MS`
- `AGENTSCIENCE_TRACE_MIN_LEVEL`
- `AGENTSCIENCE_TRACE_TIMING_ENABLED`

These are read at process start, so restart after changing them.

## What is instrumented today

The main boundaries worth knowing:

- websocket RPC requests
- orchestration command processing
- orchestration command ack timing
- provider sessions and turns
- git commands
- terminal lifecycle
- sqlite queries

Why this matters:

If the app feels slow, these boundaries are usually enough to tell whether the slowdown is in RPC, orchestration, provider work, git, terminal work, or the database.

## One metric that matters a lot

`t3_orchestration_command_ack_duration`

This measures how long it takes from command dispatch entering the orchestration engine to the first committed domain event being published by the server.

What it does tell you:

- whether the backend is slow to accept and commit a command

What it does not tell you:

- websocket transport time
- browser receipt time
- React render time

That distinction matters when somebody says "rename felt slow" or "move felt slow". This metric answers the backend part of that question only.

## How to add instrumentation

Keep it boring and useful.

Good span boundaries:

- RPC methods
- orchestration command handling
- provider calls
- external process calls
- persistence writes

Usually you want boundaries around meaningful steps, not tiny helpers.

Detailed values go on spans, for example IDs and paths.

Stable labels go on metrics, for example command type, provider kind, operation kind, outcome.

## Practical advice

If you are debugging one bad request, use traces.

If you are asking whether something is broadly slow or broadly failing, use metrics.

If you are adding new instrumentation, start with a trace span first. Add a metric only if you know what recurring question that metric is supposed to answer.
