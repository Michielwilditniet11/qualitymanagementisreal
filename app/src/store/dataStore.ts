import { create } from 'zustand'
import type { Dataset, Contract } from '../data/types'

interface Annotation {
  contractId: string
  note: string
  status: 'review' | 'renegotiate' | 'terminate' | 'ok' | ''
}

interface DataState {
  dataset: Dataset | null
  annotations: Record<string, Annotation>
  setDataset: (d: Dataset) => void
  clearDataset: () => void
  getContracts: () => Contract[]
  setAnnotation: (a: Annotation) => void
  getAnnotation: (contractId: string) => Annotation | undefined
}

export const useDataStore = create<DataState>((set, get) => ({
  dataset: null,
  annotations: {},
  setDataset: (d) => set({ dataset: d }),
  clearDataset: () => set({ dataset: null, annotations: {} }),
  getContracts: () => get().dataset?.contracts ?? [],
  setAnnotation: (a) => set(s => ({ annotations: { ...s.annotations, [a.contractId]: a } })),
  getAnnotation: (contractId) => get().annotations[contractId],
}))
