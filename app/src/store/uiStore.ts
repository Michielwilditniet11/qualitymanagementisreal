import { create } from 'zustand'

type View = 'upload' | 'web' | 'diagnostics' | 'calendar' | 'kraljic' | 'reports'

interface UIState {
  view: View
  setView: (v: View) => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'upload',
  setView: (v) => set({ view: v }),
}))
