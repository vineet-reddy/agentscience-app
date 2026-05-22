import { Debouncer } from "@tanstack/react-pacer";
import type { PersistStorage, StorageValue } from "zustand/middleware";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface DebouncedStorage<R = unknown> extends StateStorage<R> {
  flush: () => void;
}

export interface DebouncedJsonPersistStorage<S> extends PersistStorage<S> {
  flush: () => void;
}

export function createMemoryStorage(): StateStorage {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
}

export function isStateStorage(
  storage: Partial<StateStorage> | null | undefined,
): storage is StateStorage {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

export function resolveStorage(storage: Partial<StateStorage> | null | undefined): StateStorage {
  return isStateStorage(storage) ? storage : createMemoryStorage();
}

export function createDebouncedStorage(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs: number = 300,
): DebouncedStorage {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: string) => {
      resolvedStorage.setItem(name, value);
    },
    { wait: debounceMs },
  );

  return {
    getItem: (name) => resolvedStorage.getItem(name),
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      resolvedStorage.removeItem(name);
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as Promise<T>).then === "function",
  );
}

function parsePersistedStorageValue<S>(raw: string | null): StorageValue<S> | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as StorageValue<S>;
  } catch {
    return null;
  }
}

export function createDebouncedJsonPersistStorage<S>(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs: number = 300,
  options?: {
    legacyKeys?: readonly string[];
  },
): DebouncedJsonPersistStorage<S> {
  const resolvedStorage = resolveStorage(baseStorage);
  const legacyKeys = options?.legacyKeys ?? [];
  const debouncedSetItem = new Debouncer(
    (name: string, value: StorageValue<S>) => {
      resolvedStorage.setItem(name, JSON.stringify(value));
      for (const legacyName of legacyKeys) {
        if (legacyName !== name) {
          resolvedStorage.removeItem(legacyName);
        }
      }
    },
    { wait: debounceMs },
  );

  const getParsedItem = (name: string): StorageValue<S> | null | Promise<StorageValue<S> | null> => {
    const raw = resolvedStorage.getItem(name);
    if (isPromiseLike(raw)) {
      return raw.then(parsePersistedStorageValue<S>);
    }
    return parsePersistedStorageValue<S>(raw);
  };

  return {
    getItem: (name) => {
      const current = getParsedItem(name);
      if (isPromiseLike(current)) {
        return current.then(async (value) => {
          if (value !== null) {
            return value;
          }
          for (const legacyName of legacyKeys) {
            const legacyValue = await getParsedItem(legacyName);
            if (legacyValue !== null) {
              return legacyValue;
            }
          }
          return null;
        });
      }
      if (current !== null) {
        return current;
      }
      for (const legacyName of legacyKeys) {
        const legacyValue = getParsedItem(legacyName);
        if (isPromiseLike(legacyValue)) {
          return legacyValue.then(async (value) => {
            if (value !== null) {
              return value;
            }
            const startIndex = legacyKeys.indexOf(legacyName) + 1;
            for (const nextLegacyName of legacyKeys.slice(startIndex)) {
              const nextLegacyValue = await getParsedItem(nextLegacyName);
              if (nextLegacyValue !== null) {
                return nextLegacyValue;
              }
            }
            return null;
          });
        }
        if (legacyValue !== null) {
          return legacyValue;
        }
      }
      return null;
    },
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      resolvedStorage.removeItem(name);
      for (const legacyName of legacyKeys) {
        if (legacyName !== name) {
          resolvedStorage.removeItem(legacyName);
        }
      }
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}
