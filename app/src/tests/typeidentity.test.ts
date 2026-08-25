import { describe, it, expect } from 'vitest'
import { buildGraph, NODE_COLORS } from '../graph/buildGraph'
import {
  contextColor, contractStatus, isLockedRenewal, badgeFor, mixHex,
  ENTITY_TYPES, EXPIRED_DESATURATION,
} from '../analytics/typeIdentity'
import { selectionContext } from '../analytics/selection'
import { badgeTexture, badgeTextureCount } from '../graph/lib/nodeFactory'
import type { Contract, GraphNode } from '../data/types'

const NOW = new Date('2026-06-01T00:00:00Z')
const day = 86400000

function contract(p: Partial<Contract> & { name: string }): Contract {
  return {
    id: p.name, name: p.name,
    supplier: p.supplier ?? 'Acme',
    category: p.category ?? 'Software',
    department: p.department ?? 'IT',
    owner: p.owner, annualValue: p.annualValue ?? 100_000,
    startDate: p.startDate, endDate: p.endDate,
    noticePeriodDays: p.noticePeriodDays, autoRenew: p.autoRenew,
    status: p.status, paymentTerms: p.paymentTerms,
    tags: [], raw: {},
  }
}

const REGISTER = [
  contract({ name: 'Live one', owner: 'Ann', endDate: new Date(NOW.getTime() + 200 * day) }),
  contract({ name: 'Expired one', owner: 'Ann', endDate: new Date(NOW.getTime() - 30 * day) }),
  contract({ name: 'Rolled one', owner: 'Bo', endDate: new Date(NOW.getTime() - 10 * day), autoRenew: true }),
  contract({ name: 'Undated one', owner: 'Bo' }),
]

const { nodes } = buildGraph(REGISTER, 100, 100)
const byKey = new Map(nodes.map(n => [n.key, n]))
const node = (k: string): GraphNode => {
  const n = byKey.get(k)
  if (!n) throw new Error(`no node ${k}`)
  return n
}

describe('mixHex', () => {
  it('returns the first colour at t = 0 and the second at t = 1', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('normalises to lowercase, so colours compare as strings', () => {
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#ffffff')
  })

  it('blends halfway', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('clamps out-of-range blends rather than producing invalid hex', () => {
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff')
  })

  it('always produces a valid six-digit hex', () => {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      expect(mixHex(NODE_COLORS.contract, '#3A465C', t)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('contractStatus', () => {
  it('reads a future end date as live', () => {
    expect(contractStatus(node('contract::Live one'), NOW)).toBe('live')
  })

  it('reads a past end date as expired', () => {
    expect(contractStatus(node('contract::Expired one'), NOW)).toBe('expired')
  })

  it('distinguishes no end date from expired', () => {
    expect(contractStatus(node('contract::Undated one'), NOW)).toBe('undated')
  })

  it('treats non-contracts as live rather than throwing', () => {
    expect(contractStatus(node('owner::Ann'), NOW)).toBe('live')
  })
})

describe('isLockedRenewal', () => {
  it('is true for an auto-renewing contract whose term has rolled', () => {
    expect(isLockedRenewal(node('contract::Rolled one'), NOW)).toBe(true)
  })

  it('is false when the contract does not auto-renew', () => {
    expect(isLockedRenewal(node('contract::Expired one'), NOW)).toBe(false)
  })

  it('is false while the term is still running', () => {
    expect(isLockedRenewal(node('contract::Live one'), NOW)).toBe(false)
  })
})

describe('contextColor', () => {
  it('gives every entity type its own colour, whatever the lens', () => {
    for (const t of ENTITY_TYPES) {
      const n = nodes.find(x => x.type === t)!
      expect(contextColor(n, 'direct', NOW), t).toBe(NODE_COLORS[t])
    }
  })

  it('paints an owner green rather than a lens colour — the whole point', () => {
    expect(contextColor(node('owner::Ann'), 'direct', NOW)).toBe(NODE_COLORS.owner)
    // Distinct from the contract colour, so a person never reads as a contract.
    expect(contextColor(node('owner::Ann'), 'direct', NOW))
      .not.toBe(contextColor(node('contract::Live one'), 'direct', NOW))
  })

  it('leaves the core node to the lens, so the subject still shows why', () => {
    expect(contextColor(node('contract::Live one'), 'core', NOW)).toBeNull()
    expect(contextColor(node('owner::Ann'), 'core', NOW)).toBeNull()
  })

  it('leaves nodes outside the context alone', () => {
    expect(contextColor(node('owner::Ann'), undefined, NOW)).toBeNull()
  })

  it('applies the same rule to the related tier', () => {
    expect(contextColor(node('supplier::Acme'), 'related', NOW)).toBe(NODE_COLORS.supplier)
  })

  it('desaturates an expired contract but keeps it a contract', () => {
    const live = contextColor(node('contract::Live one'), 'direct', NOW)!
    const dead = contextColor(node('contract::Expired one'), 'direct', NOW)!
    expect(live).toBe(NODE_COLORS.contract)
    expect(dead).not.toBe(live)
    expect(dead).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('does not desaturate a contract with no end date', () => {
    expect(contextColor(node('contract::Undated one'), 'direct', NOW))
      .toBe(NODE_COLORS.contract)
  })

  it('flips a contract from live to expired as the clock passes its end date', () => {
    const n = node('contract::Live one')
    const after = new Date(n.contract!.endDate!.getTime() + day)
    expect(contextColor(n, 'direct', NOW)).toBe(NODE_COLORS.contract)
    expect(contextColor(n, 'direct', after)).not.toBe(NODE_COLORS.contract)
  })

  it('colours a real selection so that no two node kinds collide', () => {
    const ctx = selectionContext(node('contract::Live one'))
    const seen = new Map<string, string>()
    for (const [key, tier] of ctx.tiers) {
      const n = byKey.get(key)
      if (!n || tier === 'core') continue
      const c = contextColor(n, tier, NOW)!
      // Entities take exactly one colour each; contracts deliberately take
      // two, because live and expired must not look the same.
      if (n.type === 'contract') continue
      const prev = seen.get(n.type)
      if (prev) expect(c, n.type).toBe(prev)
      else seen.set(n.type, c)
    }
    // Every entity type present got a distinct colour.
    expect(new Set(seen.values()).size).toBe(seen.size)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('separates live from expired contracts inside the same selection', () => {
    const ctx = selectionContext(node('owner::Ann'))
    const colours = [...ctx.tiers]
      .map(([k, t]) => [byKey.get(k), t] as const)
      .filter(([n, t]) => n?.type === 'contract' && t !== 'core')
      .map(([n, t]) => contextColor(n!, t, NOW))
    // Ann owns one live and one expired contract; they must read differently.
    expect(new Set(colours).size).toBe(2)
  })
})

describe('badgeFor', () => {
  it('marks each entity type with its own glyph', () => {
    expect(badgeFor('owner')).toBe('person')
    expect(badgeFor('department')).toBe('building')
    expect(badgeFor('category')).toBe('tag')
    expect(badgeFor('supplier')).toBe('factory')
  })

  it('gives contracts no badge — a plain sphere already means contract', () => {
    expect(badgeFor('contract')).toBeNull()
  })

  it('covers every entity type, so none can silently lose its mark', () => {
    for (const t of ENTITY_TYPES) expect(badgeFor(t)).not.toBeNull()
  })
})

describe('constants', () => {
  it('desaturates expired contracts noticeably but not to invisibility', () => {
    expect(EXPIRED_DESATURATION).toBeGreaterThan(0.3)
    expect(EXPIRED_DESATURATION).toBeLessThan(0.8)
  })
})

describe('badge textures', () => {
  it('allocates one texture per glyph and colour, not one per node', () => {
    const before = badgeTextureCount()
    // A thousand nodes of four types must not mean a thousand textures.
    for (let i = 0; i < 1000; i++) {
      for (const t of ENTITY_TYPES) {
        badgeTexture(badgeFor(t)!, NODE_COLORS[t])
      }
    }
    expect(badgeTextureCount() - before).toBe(ENTITY_TYPES.length)
  })

  it('returns the identical texture object on a repeat request', () => {
    const a = badgeTexture('person', NODE_COLORS.owner)
    const b = badgeTexture('person', NODE_COLORS.owner)
    expect(a).toBe(b)
  })

  it('keeps a separate texture per colour, so glyphs can be tinted', () => {
    const before = badgeTextureCount()
    badgeTexture('person', '#123456')
    badgeTexture('person', '#654321')
    expect(badgeTextureCount() - before).toBe(2)
  })
})
