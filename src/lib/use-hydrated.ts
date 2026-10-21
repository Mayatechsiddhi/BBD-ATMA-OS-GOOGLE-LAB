"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
// Server HTML and the hydration render agree; handlers are ready before enabling submit.
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
