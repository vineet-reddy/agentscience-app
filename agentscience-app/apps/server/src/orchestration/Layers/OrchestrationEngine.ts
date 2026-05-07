import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
  WorkspaceAggregateId,
} from "@agentscience/contracts";
import { OrchestrationCommand } from "@agentscience/contracts";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  metricAttributes,
  orchestrationCommandAckDuration,
  orchestrationCommandsTotal,
  orchestrationCommandDuration,
} from "../../observability/Metrics.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  type OrchestrationDispatchError,
} from "../Errors.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";

interface CommandEnvelope {
  command: OrchestrationCommand;
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  startedAtMs: number;
}

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: "project" | "thread" | "workspace";
  readonly aggregateId: ProjectId | ThreadId | WorkspaceAggregateId;
} {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return {
        aggregateKind: "project",
        aggregateId: command.projectId,
      };
    case "workspace.rootChange":
      return {
        aggregateKind: "workspace",
        aggregateId: "workspace-root",
      };
    default:
      return {
        aggregateKind: "thread",
        aggregateId: command.threadId,
      };
  }
}

function shouldRefreshReadModelFromProjection(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.created":
    case "thread.project-set":
    case "paper.moved":
    case "workspace.root-changed":
      return true;
    default:
      return false;
  }
}

function shouldTraceDomainStreamEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.session-set":
    case "thread.turn-start-requested":
    case "thread.turn-interrupt-requested":
      return true;
    default:
      return false;
  }
}

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  let readModel = createEmptyReadModel(new Date().toISOString());

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>();

  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> => {
    const dispatchStartSequence = readModel.snapshotSequence;
    const processingStartedAtMs = Date.now();
    const aggregateRef = commandToAggregateRef(envelope.command);
    const baseMetricAttributes = {
      commandType: envelope.command.type,
      aggregateKind: aggregateRef.aggregateKind,
    } as const;
    const reconcileReadModelAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) {
        return;
      }

      let nextReadModel = readModel;
      for (const persistedEvent of persistedEvents) {
        nextReadModel = yield* projectEvent(nextReadModel, persistedEvent);
      }
      readModel = nextReadModel;

      for (const persistedEvent of persistedEvents) {
        yield* PubSub.publish(eventPubSub, persistedEvent);
      }
    });

    return Effect.exit(
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          "orchestration.command_id": envelope.command.commandId,
          "orchestration.command_type": envelope.command.type,
          "orchestration.aggregate_kind": aggregateRef.aggregateKind,
          "orchestration.aggregate_id": aggregateRef.aggregateId,
        });

        const existingReceipt = yield* commandReceiptRepository.getByCommandId({
          commandId: envelope.command.commandId,
        });
        if (Option.isSome(existingReceipt)) {
          if (existingReceipt.value.status === "accepted") {
            return {
              sequence: existingReceipt.value.resultSequence,
            };
          }
          return yield* new OrchestrationCommandPreviouslyRejectedError({
            commandId: envelope.command.commandId,
            detail: existingReceipt.value.error ?? "Previously rejected.",
          });
        }

        const eventBase = yield* decideOrchestrationCommand({
          command: envelope.command,
          readModel,
        });
        const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
        const committedCommand = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const committedEvents: OrchestrationEvent[] = [];
              let nextReadModel = readModel;

              for (const nextEvent of eventBases) {
                const savedEvent = yield* eventStore.append(nextEvent);
                nextReadModel = yield* projectEvent(nextReadModel, savedEvent);
                yield* projectionPipeline.projectEvent(savedEvent);
                committedEvents.push(savedEvent);
              }

              const lastSavedEvent = committedEvents.at(-1) ?? null;
              if (lastSavedEvent === null) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: envelope.command.type,
                  detail: "Command produced no events.",
                });
              }

              yield* commandReceiptRepository.upsert({
                commandId: envelope.command.commandId,
                aggregateKind: lastSavedEvent.aggregateKind,
                aggregateId: lastSavedEvent.aggregateId,
                acceptedAt: lastSavedEvent.occurredAt,
                resultSequence: lastSavedEvent.sequence,
                status: "accepted",
                error: null,
              });

              return {
                committedEvents,
                lastSequence: lastSavedEvent.sequence,
                nextReadModel,
              } as const;
            }),
          )
          .pipe(
            Effect.catchTag("SqlError", (sqlError) =>
              Effect.fail(
                toPersistenceSqlError(
                  "OrchestrationEngine.processEnvelope:transaction",
                )(sqlError),
              ),
            ),
          );

        const needsProjectionSnapshotRefresh = committedCommand.committedEvents.some(
          shouldRefreshReadModelFromProjection,
        );
        readModel = needsProjectionSnapshotRefresh
          ? yield* projectionSnapshotQuery.getSnapshot().pipe(
              Effect.map((snapshot) =>
                snapshot.snapshotSequence >= committedCommand.lastSequence
                  ? snapshot
                  : committedCommand.nextReadModel,
              ),
              Effect.catch((error) =>
                Effect.logWarning(
                  "failed to refresh orchestration read model from projection snapshot",
                ).pipe(
                  Effect.annotateLogs({
                    commandId: envelope.command.commandId,
                    snapshotSequence: committedCommand.lastSequence,
                    error: String(error),
                  }),
                  Effect.as(committedCommand.nextReadModel),
                ),
              ),
            )
          : committedCommand.nextReadModel;
        for (const [
          index,
          event,
        ] of committedCommand.committedEvents.entries()) {
          yield* PubSub.publish(eventPubSub, event);
          if (index === 0) {
            yield* Metric.update(
              Metric.withAttributes(
                orchestrationCommandAckDuration,
                metricAttributes({
                  ...baseMetricAttributes,
                  ackEventType: event.type,
                }),
              ),
              Duration.millis(Math.max(0, Date.now() - envelope.startedAtMs)),
            );
          }
        }
        return { sequence: committedCommand.lastSequence };
      }).pipe(
        Effect.withSpan(`orchestration.command.${envelope.command.type}`),
      ),
    ).pipe(
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          const outcome = Exit.isSuccess(exit)
            ? "success"
            : Cause.hasInterruptsOnly(exit.cause)
              ? "interrupt"
              : "failure";
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandDuration,
              metricAttributes(baseMetricAttributes),
            ),
            Duration.millis(Math.max(0, Date.now() - processingStartedAtMs)),
          );
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandsTotal,
              metricAttributes({
                ...baseMetricAttributes,
                outcome,
              }),
            ),
            1,
          );

          if (Exit.isSuccess(exit)) {
            yield* Deferred.succeed(envelope.result, exit.value);
            return;
          }

          const error = Cause.squash(exit.cause) as OrchestrationDispatchError;
          if (!Schema.is(OrchestrationCommandPreviouslyRejectedError)(error)) {
            yield* reconcileReadModelAfterDispatchFailure.pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "failed to reconcile orchestration read model after dispatch failure",
                ).pipe(
                  Effect.annotateLogs({
                    commandId: envelope.command.commandId,
                    snapshotSequence: readModel.snapshotSequence,
                  }),
                ),
              ),
            );

            if (Schema.is(OrchestrationCommandInvariantError)(error)) {
              yield* commandReceiptRepository
                .upsert({
                  commandId: envelope.command.commandId,
                  aggregateKind: aggregateRef.aggregateKind,
                  aggregateId: aggregateRef.aggregateId,
                  acceptedAt: new Date().toISOString(),
                  resultSequence: readModel.snapshotSequence,
                  status: "rejected",
                  error: error.message,
                })
                .pipe(Effect.catch(() => Effect.void));
            }
          }

          yield* Deferred.fail(envelope.result, error);
        }),
      ),
    );
  };

  yield* projectionPipeline.bootstrap;
  readModel = yield* projectionSnapshotQuery.getSnapshot();

  const worker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)),
  );
  yield* Effect.forkScoped(worker);
  yield* Effect.logDebug("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: readModel.snapshotSequence }),
  );

  const getReadModel: OrchestrationEngineShape["getReadModel"] = () =>
    Effect.sync((): OrchestrationReadModel => readModel);

  const readEvents: OrchestrationEngineShape["readEvents"] = (
    fromSequenceExclusive,
  ) => eventStore.readFromSequence(fromSequenceExclusive);

  const orderAndDedupeEvents = (
    source: Stream.Stream<OrchestrationEvent>,
    fromSequenceExclusive: number,
  ): Stream.Stream<OrchestrationEvent> =>
    Stream.unwrap(
      Effect.gen(function* () {
        type SequenceState = {
          readonly nextSequence: number;
          readonly pendingBySequence: Map<number, OrchestrationEvent>;
        };
        const state = yield* Ref.make<SequenceState>({
          nextSequence: fromSequenceExclusive + 1,
          pendingBySequence: new Map<number, OrchestrationEvent>(),
        });

        return source.pipe(
          Stream.mapEffect((event) =>
            Ref.modify(
              state,
              ({
                nextSequence,
                pendingBySequence,
              }): [Array<OrchestrationEvent>, SequenceState] => {
                if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                  return [[], { nextSequence, pendingBySequence }];
                }

                const updatedPending = new Map(pendingBySequence);
                updatedPending.set(event.sequence, event);

                const emit: Array<OrchestrationEvent> = [];
                let expected = nextSequence;
                for (;;) {
                  const expectedEvent = updatedPending.get(expected);
                  if (!expectedEvent) {
                    break;
                  }
                  emit.push(expectedEvent);
                  updatedPending.delete(expected);
                  expected += 1;
                }

                return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
              },
            ),
          ),
          Stream.flatMap((events) => Stream.fromIterable(events)),
          Stream.tap((event) =>
            shouldTraceDomainStreamEvent(event)
              ? Effect.logInfo("orchestration domain stream emitted", {
                  sequence: event.sequence,
                  type: event.type,
                  aggregateId: event.aggregateId,
                })
              : Effect.void,
          ),
        );
      }),
    );

  const streamDomainEventsWithReplay = Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(eventPubSub);
        const snapshot = yield* getReadModel();
        const fromSequenceExclusive = snapshot.snapshotSequence;
        const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
          eventStore.readFromSequence(fromSequenceExclusive),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
        );
        yield* Effect.logInfo("orchestration domain stream subscribed", {
          snapshotSequence: fromSequenceExclusive,
          replayCount: replayEvents.length,
          replayFirstSequence: replayEvents.at(0)?.sequence ?? null,
          replayLastSequence: replayEvents.at(-1)?.sequence ?? null,
        });
        const source = Stream.merge(
          Stream.fromIterable(replayEvents),
          Stream.fromSubscription(subscription),
        );
        return orderAndDedupeEvents(source, fromSequenceExclusive);
      }),
    ),
  );

  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<
        { sequence: number },
        OrchestrationDispatchError
      >();
      yield* Queue.offer(commandQueue, {
        command,
        result,
        startedAtMs: Date.now(),
      });
      return yield* Deferred.await(result);
    });

  return {
    getReadModel,
    readEvents,
    dispatch,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (wsServer, ProviderRuntimeIngestion, CheckpointReactor, etc.)
    // each independently receive all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
    streamDomainEventsWithReplay,
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);
