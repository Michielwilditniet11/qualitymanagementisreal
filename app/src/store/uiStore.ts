import { create } from 'zustand'

type View = 'upload' | 'web' | 'diagnostics' | 'calendar' | 'kraljic' | 'reports'

/** A node another screen asked the Spider Web to select on arrival. */
export interface PendingSelection {
  type: 'supplier' | 'category' | 'department' | 'owner' | 'contract'
  name: string
  /**
   * Where the jump came from, as a sentence. Shown in the Focus Frame card so
   * arriving on a node explains itself rather than dropping you somewhere.
   */
  origin?: string
}

interface UIState {
  view: View
  setView: (v: View) => void
  /** Consumed once by WebScreen, then cleared. */
  pendingSelection: PendingSelection | null
  /** Contract id another tab asked the Calendar to focus; consumed once. */
  pendingCalendarFocus: string | null
  /** Jump to the Spider Web with a node selected. */
  inspectInWeb: (sel: PendingSelection) => void
  clearPendingSelection: () => void
  /** Jump to the Calendar with a contract expanded. */
  focusInCalendar: (contractId: string) => void
  clearPendingCalendarFocus: () => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'upload',
  setView: (v) => set({ view: v }),
  pendingSelection: null,
  inspectInWeb: (sel) => set({ view: 'web', pendingSelection: sel }),
  clearPendingSelection: () => set({ pendingSelection: null }),
  pendingCalendarFocus: null,
  focusInCalendar: (contractId) => set({ view: 'calendar', pendingCalendarFocus: contractId }),
  clearPendingCalendarFocus: () => set({ pendingCalendarFocus: null }),
}))
