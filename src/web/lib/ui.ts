import { useSyncExternalStore } from 'react';

interface UiState { drawerOpen: boolean; helpOpen: boolean }
let state: UiState = { drawerOpen: false, helpOpen: false };
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getUi = () => state;

export function useUi(): UiState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}
