#!/usr/bin/env node

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const MESSAGE_CAP = 2_000;
const PLAN_CAP = 200;
const THREAD_COUNT = 100;
// ProjectionSnapshotQuery receives already-windowed SQL rows:
// ROW_NUMBER() limits messages/plans before TypeScript groups them.
const MESSAGES_PER_THREAD = MESSAGE_CAP;
const PLANS_PER_THREAD = PLAN_CAP;
const PROJECT_THREAD_COUNT = 20_000;
const ROUNDS = 7;

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function normalizeGroupedMap(map) {
  return Object.fromEntries(
    [...map.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, values.map((value) => value.id)]),
  );
}

function buildRows(kind, rowsPerThread) {
  const rows = [];
  for (let rowIndex = 1; rowIndex <= rowsPerThread; rowIndex += 1) {
    for (let threadIndex = 0; threadIndex < THREAD_COUNT; threadIndex += 1) {
      const threadId = `thread-${String(threadIndex).padStart(3, "0")}`;
      rows.push({
        id: `${threadId}-${kind}-${String(rowIndex).padStart(5, "0")}`,
        threadId,
      });
    }
  }
  return rows.toSorted(
    (left, right) => left.threadId.localeCompare(right.threadId) || left.id.localeCompare(right.id),
  );
}

function oldPerRowSliceGrouping(rows, cap) {
  const grouped = new Map();
  let copiedElements = 0;
  for (const row of rows) {
    const threadRows = grouped.get(row.threadId) ?? [];
    threadRows.push(row);
    const capped = threadRows.slice(-cap);
    copiedElements += capped.length;
    grouped.set(row.threadId, capped);
  }
  return { grouped, copiedElements };
}

function newAppendOnlyGrouping(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const threadRows = grouped.get(row.threadId) ?? [];
    threadRows.push(row);
    grouped.set(row.threadId, threadRows);
  }
  return { grouped, copiedElements: 0 };
}

function oldRepeatedSpreadIndex(threads) {
  const threadIdsByProjectId = {};
  let copiedElements = 0;
  for (const thread of threads) {
    if (thread.projectId === null) continue;
    const existingThreadIds = threadIdsByProjectId[thread.projectId] ?? [];
    copiedElements += existingThreadIds.length;
    threadIdsByProjectId[thread.projectId] = [...existingThreadIds, thread.id];
  }
  return { threadIdsByProjectId, copiedElements };
}

function newPushIndex(threads) {
  const threadIdsByProjectId = {};
  for (const thread of threads) {
    if (thread.projectId === null) continue;
    const existingThreadIds = threadIdsByProjectId[thread.projectId];
    if (existingThreadIds) {
      existingThreadIds.push(thread.id);
    } else {
      threadIdsByProjectId[thread.projectId] = [thread.id];
    }
  }
  return { threadIdsByProjectId, copiedElements: 0 };
}

function oldCheckpointFlatMap(turns) {
  return turns
    .flatMap((turn) => {
      if (
        turn.turnId === null ||
        turn.checkpointTurnCount === null ||
        turn.checkpointRef === null ||
        turn.checkpointStatus === null ||
        turn.completedAt === null
      ) {
        return [];
      }
      return [
        {
          turnId: turn.turnId,
          checkpointTurnCount: turn.checkpointTurnCount,
          checkpointRef: turn.checkpointRef,
          status: turn.checkpointStatus,
          files: turn.checkpointFiles,
          assistantMessageId: turn.assistantMessageId,
          completedAt: turn.completedAt,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        left.checkpointTurnCount - right.checkpointTurnCount ||
        left.completedAt.localeCompare(right.completedAt) ||
        left.turnId.localeCompare(right.turnId),
    )
    .slice(-500);
}

function newCheckpointLoop(turns) {
  const checkpoints = [];
  for (const turn of turns) {
    if (
      turn.turnId === null ||
      turn.checkpointTurnCount === null ||
      turn.checkpointRef === null ||
      turn.checkpointStatus === null ||
      turn.completedAt === null
    ) {
      continue;
    }
    checkpoints.push({
      turnId: turn.turnId,
      checkpointTurnCount: turn.checkpointTurnCount,
      checkpointRef: turn.checkpointRef,
      status: turn.checkpointStatus,
      files: turn.checkpointFiles,
      assistantMessageId: turn.assistantMessageId,
      completedAt: turn.completedAt,
    });
  }
  return checkpoints
    .toSorted(
      (left, right) =>
        left.checkpointTurnCount - right.checkpointTurnCount ||
        left.completedAt.localeCompare(right.completedAt) ||
        left.turnId.localeCompare(right.turnId),
    )
    .slice(-500);
}

function measure(fn) {
  const durations = [];
  let result;
  for (let round = 0; round < ROUNDS; round += 1) {
    globalThis.gc?.();
    const startedAt = performance.now();
    result = fn();
    durations.push(performance.now() - startedAt);
  }
  return { medianMs: median(durations), result };
}

const messageRows = buildRows("message", MESSAGES_PER_THREAD);
const planRows = buildRows("plan", PLANS_PER_THREAD);
const threads = Array.from({ length: PROJECT_THREAD_COUNT }, (_, index) => ({
  id: `thread-${index}`,
  projectId: index % 7 === 0 ? null : `project-${index % 5}`,
}));
const turns = Array.from({ length: 650 }, (_, index) => ({
  turnId: index % 11 === 0 ? null : `turn-${String(index).padStart(4, "0")}`,
  checkpointTurnCount: index % 13 === 0 ? null : index,
  checkpointRef: index % 17 === 0 ? null : `checkpoint-${index}`,
  checkpointStatus: index % 19 === 0 ? null : "ready",
  checkpointFiles: [{ path: `src/file-${index}.ts`, kind: "modified", additions: index, deletions: 0 }],
  assistantMessageId: `message-${index}`,
  completedAt: index % 23 === 0 ? null : new Date(Date.UTC(2026, 2, 1, 0, 0, index)).toISOString(),
}));

const oldMessages = oldPerRowSliceGrouping(messageRows, MESSAGE_CAP);
const newMessages = newAppendOnlyGrouping(messageRows);
assert.deepEqual(normalizeGroupedMap(newMessages.grouped), normalizeGroupedMap(oldMessages.grouped));

const oldPlans = oldPerRowSliceGrouping(planRows, PLAN_CAP);
const newPlans = newAppendOnlyGrouping(planRows);
assert.deepEqual(normalizeGroupedMap(newPlans.grouped), normalizeGroupedMap(oldPlans.grouped));

const oldIndex = oldRepeatedSpreadIndex(threads);
const newIndex = newPushIndex(threads);
assert.deepEqual(newIndex.threadIdsByProjectId, oldIndex.threadIdsByProjectId);

assert.deepEqual(newCheckpointLoop(turns), oldCheckpointFlatMap(turns));

const oldMessageTiming = measure(() => oldPerRowSliceGrouping(messageRows, MESSAGE_CAP));
const newMessageTiming = measure(() => newAppendOnlyGrouping(messageRows));
const oldIndexTiming = measure(() => oldRepeatedSpreadIndex(threads));
const newIndexTiming = measure(() => newPushIndex(threads));

console.log(
  JSON.stringify(
    {
      equivalence: {
        messages: "old per-row slice grouping === optimized append-only grouping",
        proposedPlans: "old per-row slice grouping === optimized append-only grouping",
        projectThreadIndex: "old repeated spread index === optimized push index",
        checkpoints: "old flatMap checkpoint builder === optimized loop checkpoint builder",
      },
      copiedElementsAvoided: {
        messages: oldMessages.copiedElements - newMessages.copiedElements,
        proposedPlans: oldPlans.copiedElements - newPlans.copiedElements,
        projectThreadIndex: oldIndex.copiedElements - newIndex.copiedElements,
      },
      medianMs: {
        oldMessageGrouping: Number(oldMessageTiming.medianMs.toFixed(2)),
        newMessageGrouping: Number(newMessageTiming.medianMs.toFixed(2)),
        oldProjectThreadIndex: Number(oldIndexTiming.medianMs.toFixed(2)),
        newProjectThreadIndex: Number(newIndexTiming.medianMs.toFixed(2)),
      },
    },
    null,
    2,
  ),
);
