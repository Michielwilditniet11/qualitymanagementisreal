export interface Contract {
  id: string
  name: string
  supplier: string
  category: string
  department: string
  owner?: string
  annualValue?: number
  currency?: string
  startDate?: Date
  endDate?: Date
  noticePeriodDays?: number
  autoRenew?: boolean
  status?: string
  paymentTerms?: string
  tags: string[]
  raw: Record<string, string>
}

export interface DataIssue {
  row: number
  field: string
  kind: 'missing' | 'unparseable' | 'duplicate'
  detail: string
}

export interface ColumnMapping {
  [targetField: string]: number
}

export interface Dataset {
  contracts: Contract[]
  importedAt: Date
  sourceName: string
  mapping: ColumnMapping
  issues: DataIssue[]
}

export interface EntityStats {
  name: string
  type: 'department' | 'category' | 'supplier' | 'owner'
  contracts: Contract[]
  totalSpend: number
  spendShare: number
  contractCount: number
  expiring90: Contract[]
  expiring180: Contract[]
  expired: Contract[]
  missingOwner: Contract[]
  missingValue: Contract[]
  supplierConcentration: number
  topSupplier?: { name: string; spend: number; share: number }
  singleSource: boolean
  healthScore: number
}

export interface GraphNode {
  key: string
  type: 'department' | 'category' | 'supplier' | 'owner' | 'contract'
  name: string
  x: number
  y: number
  vx: number
  vy: number
  value: number
  count: number
  contracts: Contract[]
  neighbors: Set<GraphNode>
  fx?: number | null
  fy?: number | null
  contract?: Contract
}

/** How two nodes relate, named from the perspective of the entity being led to. */
export type RelationType =
  | 'supplies'        // …→ supplier
  | 'owned-by'        // …→ owner
  | 'in-category'     // …→ category
  | 'in-department'   // …→ department
  | 'contract-of'     // …→ contract

export interface GraphLink {
  source: GraphNode
  target: GraphNode
  relation: RelationType
}
