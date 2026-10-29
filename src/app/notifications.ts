import { create } from 'zustand';
import { request } from '@/data/authClient';
import { useUi } from '@/state/ui';

export interface GameNotification { key: string; tick: number; kind: string; severity: 'info' | 'warning' | 'error' | 'success'; message: string; link?: string; unread: boolean }
interface NState { items: GameNotification[]; unread: number; loaded: boolean; refresh(toast?: boolean): Promise<void>; markRead(): Promise<void> }
/** Polls the server's real-event feed. New items after the first load can raise a toast (players can turn this off in Account). */
export const useNotifications = create<NState>((set, get) => ({
  items: [], unread: 0, loaded: false,
  async refresh(toast = false) {
    const r = await request<{ items: GameNotification[]; unread: number }>('/api/notifications?limit=40');
    if (r.status !== 200) return;
    const before = new Set(get().items.map((i) => i.key));
    if (toast && get().loaded) for (const n of r.body.items.filter((i) => !before.has(i.key) && i.unread).slice(0, 3)) useUi.getState().notify({ tone: n.severity === 'error' ? 'error' : n.severity === 'warning' ? 'warning' : n.severity === 'success' ? 'success' : 'info', title: n.message });
    set({ items: r.body.items, unread: r.body.unread, loaded: true });
  },
  async markRead() { const top = Math.max(0, ...get().items.map((i) => i.tick)); await request('/api/notifications/read', { method: 'POST', body: { upTo: top } }); set({ unread: 0, items: get().items.map((i) => ({ ...i, unread: false })) }); },
}));
