/**
 * Single source of truth for "when did this app session start?"
 *
 * Captured once, at module load, so every consumer sees the same value for
 * the lifetime of the renderer process. A relaunch loads a fresh bundle,
 * which re-evaluates this module and produces a new boot timestamp — which
 * is exactly the reset we want.
 *
 * Why a module constant instead of a React ref or context:
 *  - Semantically accurate: "app session" should not be tied to the lifetime
 *    of any particular component (a ref on <Sidebar /> would reset on HMR
 *    or any future remount, silently reintroducing stale state).
 *  - Trivially importable from anywhere (UI, logic, selectors) without
 *    prop-drilling or context plumbing.
 *  - Easy to mock in tests via `vi.mock("./appSession", ...)` when a test
 *    needs to pin the session clock deterministically.
 */
export const APP_SESSION_BOOT_AT: string = new Date().toISOString();
