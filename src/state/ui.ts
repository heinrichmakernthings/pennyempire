import { create } from 'zustand';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';
export interface Notice { id: number; tone: NoticeTone; title: string; message?: string }

interface UiState {
  selectedCompanyId: string | null;
  inspectorOpen: boolean;
  notices: Notice[];
  select(id: string | null): void;
  setInspectorOpen(open: boolean): void;
  notify(n: Omit<Notice, 'id'>): void;
  dismiss(id: number): void;
}
let seq = 0;
export const useUi = create<UiState>((set) => ({
  selectedCompanyId: null,
  inspectorOpen: true,
  notices: [],
  select: (id) => set({ selectedCompanyId: id, inspectorOpen: id !== null }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  notify: (n) => set((s) => ({ notices: [...s.notices.slice(-3), { ...n, id: ++seq }] })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),
}));
