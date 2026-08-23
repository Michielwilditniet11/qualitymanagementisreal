import { create } from 'zustand'

type View = 'upload' | 'web' | 'diagnostics' | 'calendar' | 'kraljic' | 'reports'

/** A node another screen asked the Spider Web to select on arrival. */
export interface PendingSelection {
  type: 'supplier' | 'category' | 'department' | 'owner' | 'contract'
  name: string
}

interface UIState {
  view: View
  setView: (v: View) => void
  /** Consumed once by WebScreen, then cleared. */
  pendingSelection: PendingSelection | null
  /** Jump to the Spider Web with a node selected. */
  inspectInWeb: (sel: PendingSelection) => void
  clearPendingSelection: () => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'upload',
  setView: (v) => set({ view: v }),
  pendingSelection: null,
  inspectInWeb: (sel) => set({ view: 'web', pendingSelection: sel }),
  clearPendingSelection: () => set({ pendingSelection: null }),
}))
