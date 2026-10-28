import { useCallback, useState } from 'react';
import type { Command } from '@/contracts/game-state';
import { useUi } from '@/state/ui';
import { useDataActions, useDataSource } from './store';

/** Fresh key per user intent; reused across retries of the same intent so the server can deduplicate. */
export const newIdempotencyKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export type CommandBody = Command extends infer C ? (C extends unknown ? Omit<C, 'idempotencyKey' | 'expectedRevision'> : never) : never;

/**
 * Sends a command to the data source and reports the outcome in the notification region.
 * It never mutates local balances or inventory: success only triggers a refresh of what the server says.
 */
export function useCommand() {
  const source = useDataSource();
  const { refreshAll } = useDataActions();
  const notify = useUi((s) => s.notify);
  const [pending, setPending] = useState(false);
  const send = useCallback(async (body: CommandBody, meta: { idempotencyKey: string; expectedRevision: number }, labels: { success: string; failure: string }) => {
    setPending(true);
    try {
      const res = await source.submitCommand({ ...body, ...meta } as Command);
      if (res.ok) { notify({ tone: 'success', title: labels.success }); refreshAll(); }
      else notify({ tone: 'error', title: labels.failure, message: res.error.message });
      return res;
    } catch (e) {
      notify({ tone: 'error', title: labels.failure, message: e instanceof Error ? e.message : 'Unexpected error' });
      return null;
    } finally { setPending(false); }
  }, [source, notify, refreshAll]);
  return { send, pending };
}
