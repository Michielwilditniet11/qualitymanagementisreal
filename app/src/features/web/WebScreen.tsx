import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import { buildGraph, NODE_COLORS } from '../../graph/buildGraph'
import PlanetaryWeb, { riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff } from '../../graph/PlanetaryWeb'
import type { WebHandle } from '../../graph/PlanetaryWeb'
import { AlertTriangle, Shield, ShieldCheck, User, Building2, Tag, DollarSign, FileText, ChevronRight, ChevronLeft, X, Play, Sun } from 'lucide-react'
import type { GraphNode } from '../../data/types'
import { LENSES, type LensId } from '../../analytics/lenses'
import { generateInsights, totalValueAtRisk, type Insight } from '../../analytics/insights'
import { computeCentrality, assessImpact } from '../../analytics/centrality'
import { findGaps, gapExposure, type Gap } from '../../analytics/gaps'
import { buildStory, type StoryStep } from '../../analytics/story'
import { negotiationCalendar } from '../../analytics/levers'
import { lensBriefing, lensBadges } from '../../analytics/briefings'
import { buildFocusFrame, type FocusFrame, type FrameSource } from '../../analytics/focusFrame'
import FrameCard from './FrameCard'
import { T, Tick, TerminalSelect } from '../../ui'

/* Terminal tokens live in src/ui/theme; re-exported so existing imports of
   `T` from this module keep working. */
export { T }

type RiskFilter = 'all' | 'high' | 'medium+'

/** First-run guidance, anchored near the UI each step describes. */
const COACH = [
  {
    title: 'This is your contract network',
    body: 'Every dot is a contract, supplier, category, department or owner. Hover to feel the connections, click to have a node explain itself, double-click to isolate it.',
    pos: { top: '38%', left: '30%' },
  },
  {
    title: 'Lenses answer one question each',
    body: 'Each lens recolours the whole map for a single question, and the number on a tab tells you how much it found here. The strip beneath names the top three.',
    pos: { top: '96px', left: '24px' },
  },
  {
    title: 'PRESENT walks a room through it',
    body: 'Turns this data into a narrated fly-through — the money, the dependencies, the risks, the gaps, and what to do next. Arrow keys step through it.',
    pos: { top: '58px', right: '24px' },
  },
] as const

const SHORTCUTS: [string, string][] = [
  ['1–7', 'switch lens'],
  ['F', 'fit everything'],
  ['S', 'spotlight'],
  ['Esc', 'release frame, then selection'],
  ['Alt ←', 'back'],
  ['?', 'this sheet'],
  ['← →', 'story steps'],
  ['dbl-click', 'focus a node'],
]

export default function WebScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const [selected, setSelectedRaw] = useState<GraphNode | null>(null)
  const [visibleTypes, setVisibleTypes] = useState<Record<string, boolean>>({
    department: true, category: true, supplier: true, owner: true, contract: true,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [spendThreshold, setSpendThreshold] = useState(0)
  const [highlightExpiring, setHighlightExpiring] = useState(0)
  const [lens, setLens] = useState<LensId>('structure')
  const [activeInsight, setActiveInsight] = useState<Insight | null>(null)
  const [frame, setFrame] = useState<FocusFrame | null>(null)
  /** An arrival from another tab, held until openFrame exists below. */
  const [pendingFrameKey, setPendingFrameKey] =
    useState<{ key: string; origin?: string } | null>(null)
  const goToTab = useUIStore(s => s.setView)
  const [focusNode, setFocusNode] = useState<GraphNode | null>(null)
  const [deptFilter, setDeptFilter] = useState<Set<string>>(new Set())
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [spotlight, setSpotlight] = useState(false)
  const [story, setStory] = useState<StoryStep[] | null>(null)
  const [storyIdx, setStoryIdx] = useState(0)
  const handleRef = useRef<WebHandle | null>(null)
  const [briefingOpen, setBriefingOpen] = useState(true)
  const [coachStep, setCoachStep] = useState(0)
  const [showKeys, setShowKeys] = useState(false)

  const { nodes, links } = useMemo(() => buildGraph(contracts, 900, 600), [contracts])
  const insights = useMemo(() => generateInsights(contracts), [contracts])
  const gaps = useMemo(() => findGaps(contracts, nodes), [contracts, nodes])
  const calendar = useMemo(() => negotiationCalendar(contracts), [contracts])
  const briefing = useMemo(() => lensBriefing(lens, contracts, nodes), [lens, contracts, nodes])
  const badges = useMemo(() => lensBadges(contracts, nodes), [contracts, nodes])

  /* ─── Selection with history ─── */
  const historyRef = useRef<GraphNode[]>([])
  const [trail, setTrail] = useState<GraphNode[]>([])
  const setSelected = useCallback((n: GraphNode | null) => {
    setSelectedRaw(prev => {
      if (n && n !== prev) {
        if (prev) historyRef.current = [...historyRef.current.slice(-19), prev]
        setTrail(t => {
          const next = [...t.filter(x => x.key !== n.key), n]
          return next.slice(-5)
        })
      }
      return n
    })
  }, [])
  const goBack = useCallback(() => {
    const prev = historyRef.current.pop()
    if (prev) setSelectedRaw(prev)
    else setSelectedRaw(null)
  }, [])

  // Another screen (Diagnostics) asked for a node to be inspected here.
  const pendingSelection = useUIStore(s => s.pendingSelection)
  const clearPendingSelection = useUIStore(s => s.clearPendingSelection)
  useEffect(() => {
    if (!pendingSelection) return
    const n = nodes.find(x => x.type === pendingSelection.type && x.name === pendingSelection.name)
    if (n) {
      setSelected(n)
      setActiveInsight(null)
      setFocusNode(null)
      // Arrive framed, not merely selected: the point of the jump is to see
      // what this node connects to.
      setPendingFrameKey({ key: n.key, origin: pendingSelection.origin })
    }
    clearPendingSelection()
  }, [pendingSelection, nodes, clearPendingSelection, setSelected])

  /* ─── Filters → hidden nodes ─── */
  const departments = useMemo(
    () => [...new Set(contracts.map(c => c.department).filter(Boolean))].sort(),
    [contracts])

  const hiddenKeys = useMemo(() => {
    const hidden = new Set<string>()
    const deptActive = deptFilter.size > 0
    const passDept = (d?: string) => !deptActive || (d ? deptFilter.has(d) : false)
    const passRisk = (n: GraphNode) => {
      if (riskFilter === 'all' || n.type !== 'contract') return true
      const lvl = riskLevel(riskScore(n))
      return riskFilter === 'high' ? lvl === 'high' : lvl !== 'low'
    }
    for (const n of nodes) {
      if (n.type === 'contract') {
        if (!passDept(n.contract?.department) || !passRisk(n)) hidden.add(n.key)
      } else if (n.type === 'department') {
        if (deptActive && !deptFilter.has(n.name)) hidden.add(n.key)
      } else {
        // Entities survive if any of their contracts survive the filters.
        const alive = n.contracts.some(c =>
          passDept(c.department) &&
          (riskFilter === 'all' || (() => {
            const cn = nodes.find(x => x.type === 'contract' && x.contract?.id === c.id)
            return cn ? passRisk(cn) : true
          })()))
        if (!alive) hidden.add(n.key)
      }
    }
    return hidden
  }, [nodes, deptFilter, riskFilter])

  /**
   * Every jump into the web goes through here. A frame stages the induced
   * subgraph, its lens and its explanation together, so no entry point can
   * move the camera and leave the user to work out why.
   */
  const openFrame = useCallback((source: FrameSource) => {
    const f = buildFocusFrame(source, nodes, links, contracts)
    if (!f) return
    setFrame(prev => {
      if (prev?.id === f.id) return null   // clicking the same thing releases it
      setLens(f.lens)
      setFocusNode(null)
      // A frame is a new subject, so a selection left over from the last one
      // would leave the drawer describing something the card does not.
      // An 'entity' frame is the exception: there the selection *is* the subject.
      if (source.kind !== 'entity') setSelectedRaw(null)
      return f
    })
  }, [nodes, links, contracts])

  const clearFrame = useCallback(() => {
    setFrame(null); setActiveInsight(null)
  }, [])

  useEffect(() => {
    if (!pendingFrameKey) return
    openFrame({ kind: 'entity', nodeKey: pendingFrameKey.key, origin: pendingFrameKey.origin })
    setPendingFrameKey(null)
  }, [pendingFrameKey, openFrame])

  /* ─── Story mode drives lens + frame + camera through the same path ─── */
  const storyStep = story?.[storyIdx] ?? null

  useEffect(() => {
    if (!storyStep) return
    setLens(storyStep.lens)
    if (storyStep.camera === 'overview' || storyStep.nodeKeys.length === 0) {
      setFrame(null)
      const t = setTimeout(() => handleRef.current?.fit(), 120)
      return () => clearTimeout(t)
    }
    setFrame(buildFocusFrame({ kind: 'story', step: storyStep }, nodes, links, contracts))
  }, [storyStep, nodes, links, contracts])

  const startStory = () => {
    const s = buildStory(contracts, nodes)
    if (s.length === 0) return
    setSelected(null); setActiveInsight(null); setFocusNode(null); setFrame(null)
    setStory(s); setStoryIdx(0); setSpotlight(true)
  }
  const exitStory = useCallback(() => {
    setStory(null); setSpotlight(false); setFrame(null)
    handleRef.current?.fit()
  }, [])

  /* ─── Keyboard: lenses, story nav, spotlight ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (story) {
        if (e.key === 'ArrowRight') setStoryIdx(i => Math.min(i + 1, story.length - 1))
        else if (e.key === 'ArrowLeft') setStoryIdx(i => Math.max(i - 1, 0))
        else if (e.key === 'Escape') exitStory()
        return
      }
      // Esc peels one layer at a time; the frame is the outermost.
      if (e.key === 'Escape' && frame) { clearFrame(); return }
      const li = parseInt(e.key)
      if (li >= 1 && li <= LENSES.length) setLens(LENSES[li - 1].id)
      else if (e.key === 's' || e.key === 'S') setSpotlight(v => !v)
      else if (e.key === '?') setShowKeys(v => !v)
      else if (e.key === 'ArrowLeft' && e.altKey) goBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [story, exitStory, goBack, frame, clearFrame])

  /* ─── Ticker figures ─── */
  const kpis = useMemo(() => {
    const totalSpend = contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0)
    const expiring = contracts.filter(c => c.endDate && daysDiff(c.endDate) > 0 && daysDiff(c.endDate) <= 90)
    return {
      totalSpend,
      atRisk: totalValueAtRisk(insights, contracts),
      expiringCount: expiring.length,
      expiringValue: expiring.reduce((s, c) => s + (c.annualValue ?? 0), 0),
      gapCount: gaps.length,
      gapExposure: gapExposure(gaps, contracts),
      openWindows: calendar.filter(i => i.kind === 'notice-deadline' && !i.missed).length,
    }
  }, [contracts, insights, gaps, calendar])

  const openInsight = (i: Insight) => {
    if (activeInsight?.id === i.id) { setActiveInsight(null); setFrame(null); return }
    setActiveInsight(i)
    setSelectedRaw(null)
    openFrame({ kind: 'insight', insight: i })
  }

  const toggleType = (t: string) => {
    setVisibleTypes(v => {
      const next = { ...v, [t]: !v[t] }
      if (selected && !next[selected.type]) setSelectedRaw(null)
      return next
    })
  }

  const handleLegendChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.dataset.type
    if (type) toggleType(type)
  }

  const maxSpend = Math.max(1, ...contracts.map(c => c.annualValue ?? 0))

  const navigateTo = (type: string, name: string) => {
    const n = nodes.find(nd => nd.type === type && nd.name === name)
    if (n) setSelected(n)
  }

  const clearAll = () => {
    setSelectedRaw(null); setActiveInsight(null); setFocusNode(null); setFrame(null)
    setDeptFilter(new Set()); setRiskFilter('all'); setSearchQuery('')
    setSpendThreshold(0); setHighlightExpiring(0); setSpotlight(false)
    setVisibleTypes({ department: true, category: true, supplier: true, owner: true, contract: true })
  }

  /* Active state chips — the single answer to "what am I looking at". */
  const chips: { label: string; onClear: () => void; hue?: string }[] = []
  if (lens !== 'structure') chips.push({ label: `LENS ${lens.toUpperCase()}`, onClear: () => setLens('structure'), hue: T.cyan })
  for (const d of deptFilter) chips.push({ label: `DEPT ${d.toUpperCase()}`, onClear: () => setDeptFilter(s => { const n = new Set(s); n.delete(d); return n }) })
  if (riskFilter !== 'all') chips.push({ label: `RISK ${riskFilter.toUpperCase()}`, onClear: () => setRiskFilter('all'), hue: T.red })
  if (spendThreshold > 0) chips.push({ label: `MIN ${fmtK(spendThreshold)}`, onClear: () => setSpendThreshold(0) })
  if (highlightExpiring > 0) chips.push({ label: `EXP ≤${highlightExpiring}D`, onClear: () => setHighlightExpiring(0), hue: T.amber })
  if (searchQuery) chips.push({ label: `FIND "${searchQuery.toUpperCase()}"`, onClear: () => setSearchQuery('') })
  if (focusNode) chips.push({ label: `FOCUS ${focusNode.name.toUpperCase()}`, onClear: () => setFocusNode(null), hue: T.cyan })
  if (frame) chips.push({ label: `FRAME ${frame.title.toUpperCase()}`, onClear: clearFrame, hue: T.amber })
  if (spotlight && !story) chips.push({ label: 'SPOTLIGHT', onClear: () => setSpotlight(false), hue: T.amber })
  const hiddenTypes = Object.entries(visibleTypes).filter(([, v]) => !v)
  for (const [t] of hiddenTypes) chips.push({ label: `HIDE ${t.toUpperCase()}S`, onClear: () => toggleType(t) })

  return (
    <div className="flex-1 flex min-h-0" style={{ background: T.ground }}>
      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden relative" onClick={handleLegendChange as any}>

        {/* ─── Ticker strip ─── */}
        {!story && (
          <div className="flex items-stretch overflow-x-auto border-b"
            style={{ background: T.ground, borderColor: T.hairline, fontFamily: T.mono }}>
            <Tick label="SPEND" value={fmtK(kpis.totalSpend)} color={T.text}
              onClick={() => openFrame({ kind: 'kpi', metric: 'spend' })} />
            <Tick label="AT RISK" value={fmtK(kpis.atRisk)} color={T.red}
              onClick={() => openFrame({ kind: 'kpi', metric: 'atRisk' })}
              sub={kpis.totalSpend > 0 ? `${Math.round((kpis.atRisk / kpis.totalSpend) * 100)}%` : undefined} />
            <Tick label="EXP 90D" value={`${kpis.expiringCount}·${fmtK(kpis.expiringValue)}`} color={T.amber}
              onClick={() => openFrame({ kind: 'kpi', metric: 'expiring' })} />
            <Tick label="WINDOWS" value={String(kpis.openWindows)} color={T.cyan}
              onClick={() => openFrame({ kind: 'kpi', metric: 'windows' })} />
            <Tick label="GAPS" value={`${kpis.gapCount}·${fmtK(kpis.gapExposure)}`} color="#F472B6"
              onClick={() => openFrame({ kind: 'kpi', metric: 'gaps' })} />
            <div className="flex-1" style={{ borderRight: 'none' }} />
            <button onClick={startStory}
              className="flex items-center gap-1.5 px-4 text-[10px] font-semibold tracking-widest cursor-pointer flex-shrink-0 transition-colors hover:brightness-125"
              style={{ color: T.ground, background: T.cyan, fontFamily: T.mono }}>
              <Play size={10} fill={T.ground} /> PRESENT
            </button>
          </div>
        )}

        {/* ─── Command bar: lens + filters ─── */}
        {!story && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap"
            style={{ background: T.panel, borderColor: T.hairline }}>
            <div className="flex overflow-hidden flex-shrink-0" style={{ border: `1px solid ${T.hairline}` }}>
              {LENSES.map((l, i) => (
                <button key={l.id} onClick={() => setLens(l.id)} title={`${l.question} (${i + 1})`}
                  className="px-2 py-0.5 text-[10px] tracking-wider cursor-pointer transition-colors"
                  style={{
                    fontFamily: T.mono,
                    background: lens === l.id ? T.cyan : 'transparent',
                    color: lens === l.id ? T.ground : T.muted,
                    fontWeight: lens === l.id ? 700 : 400,
                  }}>
                  {l.label.toUpperCase()}
                  {badges[l.id] !== undefined && badges[l.id]! > 0 && (
                    <span className="ml-1 tabular-nums" style={{ fontSize: '9px', opacity: 0.65 }}>
                      {badges[l.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <input
              type="text" placeholder="FIND NODE…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="px-2 py-0.5 text-[10px] tracking-wider w-36"
              style={{
                fontFamily: T.mono, background: T.ground, color: T.text,
                border: `1px solid ${T.hairline}`, outline: 'none',
              }}
            />

            <TerminalSelect
              value="" label={deptFilter.size === 0 ? 'DEPT: ALL' : `DEPT: ${deptFilter.size}`}
              onChange={v => {
                if (!v) return
                setDeptFilter(s => {
                  const n = new Set(s)
                  n.has(v) ? n.delete(v) : n.add(v)
                  return n
                })
              }}
              options={departments.map(d => ({
                value: d, label: `${deptFilter.has(d) ? '■ ' : '□ '}${d}`,
              }))}
            />

            <TerminalSelect
              value={riskFilter} label={`RISK: ${riskFilter.toUpperCase()}`}
              onChange={v => setRiskFilter((v || 'all') as RiskFilter)}
              options={[
                { value: 'all', label: 'All levels' },
                { value: 'medium+', label: 'Medium & high' },
                { value: 'high', label: 'High only' },
              ]}
            />

            <TerminalSelect
              value={String(highlightExpiring)} label={highlightExpiring ? `EXP: ${highlightExpiring}D` : 'EXP: OFF'}
              onChange={v => setHighlightExpiring(parseInt(v || '0'))}
              options={[
                { value: '0', label: 'Off' }, { value: '30', label: '30 days' },
                { value: '90', label: '90 days' }, { value: '180', label: '180 days' },
                { value: '365', label: '1 year' },
              ]}
            />

            <div className="flex items-center gap-1.5 text-[10px]" style={{ color: T.muted, fontFamily: T.mono }}>
              <span>MIN</span>
              <input type="range" min={0} max={maxSpend} step={1000} value={spendThreshold}
                onChange={e => setSpendThreshold(parseInt(e.target.value))}
                className="w-20 accent-[#2FD3E6]" />
              <span style={{ color: spendThreshold > 0 ? T.amber : T.muted }} className="tabular-nums w-14">
                {fmtK(spendThreshold)}
              </span>
            </div>

            <div className="flex-1" />
            <button onClick={() => setSpotlight(v => !v)} title="Spotlight (S)"
              className="p-1 cursor-pointer transition-colors"
              style={{ color: spotlight ? T.amber : T.muted }}>
              <Sun size={12} />
            </button>
          </div>
        )}

        {/* ─── State chips + breadcrumbs ─── */}
        {!story && (chips.length > 0 || trail.length > 0) && (
          <div className="flex items-center gap-1.5 px-3 py-1 border-b flex-wrap"
            style={{ background: T.ground, borderColor: T.hairline }}>
            {historyRef.current.length > 0 && (
              <button onClick={goBack} title="Back (Alt+←)"
                className="flex items-center cursor-pointer p-0.5"
                style={{ color: T.cyan }}>
                <ChevronLeft size={12} />
              </button>
            )}
            {trail.length > 1 && (
              <div className="flex items-center gap-1 mr-1">
                {trail.slice(0, -1).map(n => (
                  <button key={n.key} onClick={() => setSelected(n)}
                    className="text-[9px] tracking-wider cursor-pointer hover:underline"
                    style={{ color: T.muted, fontFamily: T.mono }}>
                    {n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name} ›
                  </button>
                ))}
              </div>
            )}
            {chips.map(c => (
              <button key={c.label} onClick={c.onClear}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] tracking-wider cursor-pointer group"
                style={{
                  fontFamily: T.mono, color: c.hue ?? T.muted,
                  border: `1px solid ${c.hue ?? T.hairline}`, background: T.panel,
                }}>
                {c.label}
                <X size={8} className="opacity-50 group-hover:opacity-100" />
              </button>
            ))}
            {chips.length > 1 && (
              <button onClick={clearAll}
                className="px-1.5 py-0.5 text-[9px] tracking-wider cursor-pointer"
                style={{ fontFamily: T.mono, color: T.red, border: `1px solid ${T.hairline}` }}>
                CLEAR ALL
              </button>
            )}
          </div>
        )}

        {/* ─── Lens briefing: what this lens found in this dataset ─── */}
        {!story && briefingOpen && briefing.items.length > 0 && (
          <div className="flex items-start gap-3 px-3 py-1.5 flex-shrink-0"
            style={{ background: T.ground, borderBottom: `1px solid ${T.hairline}` }}>
            <div className="flex-shrink-0" style={{ width: '190px' }}>
              <div className="text-[9px] tracking-[0.18em]" style={{ color: T.cyan, fontFamily: T.mono }}>
                {briefing.question.toUpperCase()}
              </div>
              <div className="text-[9px] mt-0.5 leading-snug" style={{ color: T.muted }}>
                {briefing.scaleNote}
              </div>
            </div>
            <div className="flex-1 flex gap-2 flex-wrap min-w-0">
              {briefing.items.map((it, i) => (
                <button key={i}
                  onClick={() => openFrame({ kind: 'briefing', lens, item: it, index: i })}
                  className="flex items-baseline gap-2 px-2 py-1 text-left cursor-pointer transition-colors hover:brightness-150 min-w-0"
                  style={{ background: T.panel, border: `1px solid ${T.hairline}`, maxWidth: '340px' }}>
                  <span className="text-[10px] truncate" style={{ color: T.dim }}>{it.label}</span>
                  <span className="text-[10px] tabular-nums flex-shrink-0 font-semibold"
                    style={{ color: T.amber, fontFamily: T.mono }}>{it.figure}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setBriefingOpen(false)} aria-label="Hide lens briefing"
              className="flex-shrink-0 text-[9px] tracking-wider cursor-pointer px-1"
              style={{ color: T.faint, fontFamily: T.mono }}>HIDE</button>
          </div>
        )}
        {!story && !briefingOpen && (
          <button onClick={() => setBriefingOpen(true)}
            className="px-3 py-0.5 text-[9px] tracking-wider text-left cursor-pointer flex-shrink-0"
            style={{ color: T.faint, fontFamily: T.mono, background: T.ground, borderBottom: `1px solid ${T.hairline}` }}>
            SHOW WHAT THIS LENS FOUND ▾
          </button>
        )}

        <PlanetaryWeb
          nodes={nodes} links={links}
          visibleTypes={visibleTypes} selected={selected}
          onSelect={setSelected}
          searchQuery={searchQuery}
          spendThreshold={spendThreshold}
          highlightExpiring={highlightExpiring}
          lens={lens}
          focusFrame={frame}
          focusNode={focusNode}
          onFocus={setFocusNode}
          gaps={gaps}
          hiddenKeys={hiddenKeys}
          spotlight={spotlight || Boolean(story)}
          chromeless={Boolean(story)}
          onReady={h => { handleRef.current = h }}
        />

        {/* ─── The frame's explanation — why this picture, how to read it ─── */}
        {frame && (
          <FrameCard
            frame={frame} nodes={nodes}
            step={story ? `${storyIdx + 1} / ${story.length}` : undefined}
            onSelect={n => setSelected(n)}
            onClose={story ? exitStory : clearFrame}
            onCrossLink={target => {
              if (target === 'calendar') goToTab('calendar')
              else goToTab('diagnostics')
            }}
          />
        )}

        {/* ─── First-run coach marks ─── */}
        {!story && coachStep < COACH.length && (
          <div className="absolute inset-0 z-30" style={{ background: 'rgba(4,7,14,0.55)' }}
            onClick={() => setCoachStep(i => i + 1)}>
            <div className="absolute rounded-sm p-3 max-w-xs"
              style={{
                ...COACH[coachStep].pos,
                background: T.ground, border: `1px solid ${T.cyan}`,
                boxShadow: '0 0 24px rgba(47,211,230,0.25)',
              }}>
              <div className="text-[9px] tracking-[0.18em] mb-1" style={{ color: T.cyan, fontFamily: T.mono }}>
                {coachStep + 1} / {COACH.length}
              </div>
              <div className="text-[12px] font-semibold text-white mb-1">{COACH[coachStep].title}</div>
              <div className="text-[11px] leading-relaxed" style={{ color: T.dim }}>{COACH[coachStep].body}</div>
              <div className="text-[9px] mt-2 tracking-wider" style={{ color: T.muted, fontFamily: T.mono }}>
                CLICK TO CONTINUE · ? REOPENS
              </div>
            </div>
          </div>
        )}

        {/* ─── Shortcut sheet ─── */}
        {showKeys && (
          <div className="absolute inset-0 z-40 flex items-center justify-center"
            style={{ background: 'rgba(4,7,14,0.85)' }} onClick={() => setShowKeys(false)}>
            <div className="p-5 rounded-sm" style={{ background: T.ground, border: `1px solid ${T.hairline}` }}>
              <div className="text-[10px] tracking-[0.18em] mb-3" style={{ color: T.cyan, fontFamily: T.mono }}>
                KEYBOARD
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="flex items-baseline gap-3 text-[10px]" style={{ fontFamily: T.mono }}>
                    <span className="px-1.5 tabular-nums" style={{ color: T.amber, border: `1px solid ${T.hairline}` }}>{k}</span>
                    <span style={{ color: T.dim }}>{d}</span>
                  </div>
                ))}
              </div>
              <div className="text-[9px] mt-3 tracking-wider" style={{ color: T.muted, fontFamily: T.mono }}>
                ESC OR CLICK TO CLOSE
              </div>
            </div>
          </div>
        )}

        {/* ─── Story overlay ─── */}
        {story && storyStep && (
          <>
            <div className="absolute bottom-16 left-6 max-w-md rounded-sm p-4 z-10"
              style={{
                background: 'rgba(4,7,14,0.94)', border: `1px solid ${T.hairline}`,
                borderLeft: `2px solid ${T.cyan}`, backdropFilter: 'blur(14px)',
              }}>
              <div className="text-[9px] tracking-widest mb-1" style={{ color: T.cyan, fontFamily: T.mono }}>
                {String(storyIdx + 1).padStart(2, '0')} / {String(story.length).padStart(2, '0')} · {storyStep.source.toUpperCase()}
              </div>
              <div className="text-base font-bold text-white mb-1.5">{storyStep.title}</div>
              <div className="text-[12px] leading-relaxed" style={{ color: '#B6C2D4' }}>
                {storyStep.narration}
              </div>
              {storyStep.figure && (
                <div className="mt-2 text-lg font-bold tabular-nums" style={{ color: T.amber, fontFamily: T.mono }}>
                  {storyStep.figure}
                </div>
              )}
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10 rounded-sm px-3 py-1.5"
              style={{ background: 'rgba(4,7,14,0.94)', border: `1px solid ${T.hairline}`, backdropFilter: 'blur(14px)' }}>
              <button onClick={() => setStoryIdx(i => Math.max(i - 1, 0))} disabled={storyIdx === 0}
                className="cursor-pointer disabled:opacity-30" style={{ color: T.cyan }}>
                <ChevronLeft size={14} />
              </button>
              <div className="flex gap-1.5">
                {story.map((s, i) => (
                  <button key={s.id} onClick={() => setStoryIdx(i)}
                    className="cursor-pointer rounded-full"
                    style={{
                      width: '7px', height: '7px',
                      background: i === storyIdx ? T.cyan : T.hairline,
                    }} />
                ))}
              </div>
              <button onClick={() => setStoryIdx(i => Math.min(i + 1, story.length - 1))}
                disabled={storyIdx === story.length - 1}
                className="cursor-pointer disabled:opacity-30" style={{ color: T.cyan }}>
                <ChevronRight size={14} />
              </button>
              <button onClick={exitStory}
                className="text-[9px] tracking-widest px-2 py-0.5 cursor-pointer"
                style={{ fontFamily: T.mono, color: T.muted, border: `1px solid ${T.hairline}` }}>
                ESC EXIT
              </button>
            </div>
          </>
        )}
      </div>

      {/* ─── Right-side inspection drawer ─── */}
      {!story && (
        <div className="w-80 flex-shrink-0 border-l overflow-y-auto overflow-x-hidden"
          style={{ background: T.panel, borderColor: T.hairline }}>
          {!selected ? (
            lens === 'gaps' ? (
              <GapsPanel gaps={gaps} contracts={contracts} activeId={frame?.id ?? null}
                onOpenGap={gap => openFrame({ kind: 'gap', gap })} />
            ) : (
              <InsightsPanel
                nodes={nodes} links={links} contracts={contracts}
                insights={insights} active={activeInsight}
                onOpen={openInsight} onClear={() => setActiveInsight(null)}
                onSelectNode={setSelected}
              />
            )
          ) : selected.type === 'contract' && selected.contract ? (
            <ContractDetail node={selected} onNavigate={navigateTo} />
          ) : (
            <EntityDetail node={selected} nodes={nodes} onSelect={setSelected}
              contracts={contracts} focusNode={focusNode} onFocus={setFocusNode} />
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Terminal primitives ─── */


function GapsPanel({ gaps, contracts, onOpenGap, activeId }: {
  gaps: Gap[]; contracts: any[]
  onOpenGap: (g: Gap) => void
  activeId: string | null
}) {
  const exposure = gapExposure(gaps, contracts)
  return (
    <div className="p-4">
      <h2 className="font-semibold text-sm mb-1 text-white">What is missing</h2>
      <p className="text-xs mb-3" style={{ color: '#64748B' }}>
        Structure that should exist and does not. Hollow nodes mark the absences.
      </p>
      <div className="rounded-sm px-3 py-2 mb-4" style={{ background: T.ground, border: `1px solid ${T.hairline}` }}>
        <div className="text-[8px] tracking-[0.18em]" style={{ color: T.muted, fontFamily: T.mono }}>TOTAL EXPOSED</div>
        <div className="text-lg font-bold tabular-nums" style={{ color: '#F472B6', fontFamily: T.mono }}>{fmtK(exposure)}</div>
      </div>
      {gaps.length === 0 && (
        <p className="text-xs" style={{ color: '#64748B' }}>No structural gaps — the register is complete.</p>
      )}
      <div className="space-y-2">
        {gaps.map(g => (
          <button key={g.id} onClick={() => onOpenGap(g)}
            className="w-full text-left rounded-sm p-2.5 cursor-pointer transition-colors hover:border-[#F472B6]"
            style={{
              background: T.ground,
              border: `1px solid ${activeId === `gap:${g.id}` ? '#F472B6' : T.hairline}`,
            }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium text-white">{g.title}</span>
              <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: '#F472B6', fontFamily: T.mono }}>
                {fmtK(g.exposure)}
              </span>
            </div>
            <div className="text-[10px] mt-1 leading-relaxed" style={{ color: '#94A3B8' }}>{g.detail}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626', warning: '#D97706', info: '#0EA5E9',
}

function InsightsPanel({ nodes, links, contracts, insights, active, onOpen, onClear, onSelectNode }: {
  nodes: GraphNode[]
  links: { source: GraphNode; target: GraphNode }[]
  contracts: any[]
  insights: Insight[]
  active: Insight | null
  onOpen: (i: Insight) => void
  onClear: () => void
  onSelectNode: (n: GraphNode) => void
}) {
  const totalSpend = contracts.reduce((s: number, c: any) => s + (c.annualValue ?? 0), 0)
  const atRisk = useMemo(() => totalValueAtRisk(insights, contracts), [insights, contracts])

  const topSuppliers = useMemo(() => computeCentrality(nodes, 'supplier').slice(0, 5), [nodes])
  const topOwners = useMemo(() => computeCentrality(nodes, 'owner').slice(0, 5), [nodes])

  const counts = useMemo(() => ({
    critical: insights.filter(i => i.severity === 'critical').length,
    warning: insights.filter(i => i.severity === 'warning').length,
    info: insights.filter(i => i.severity === 'info').length,
  }), [insights])

  return (
    <div className="p-4">
      <h2 className="font-semibold text-sm mb-1 text-white">What needs attention</h2>
      <p className="text-xs mb-3" style={{ color: '#64748B' }}>
        {insights.length === 0
          ? 'No material findings in this portfolio.'
          : 'Click a finding to highlight it in the web.'}
      </p>

      <div className="space-y-2 mb-4">
        <StatRow icon={<DollarSign size={13} />} label="Total spend" value={fmtK(totalSpend)} />
        <StatRow icon={<AlertTriangle size={13} />} label="Value at risk" value={fmtK(atRisk)} />
        <StatRow icon={<FileText size={13} />} label="Nodes" value={String(nodes.length)} />
        <StatRow icon={<ChevronRight size={13} />} label="Connections" value={String(links.length)} />
      </div>

      {active && (
        <button onClick={onClear}
          className="w-full mb-3 text-[10px] py-1.5 rounded-lg cursor-pointer transition-colors hover:text-white"
          style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}>
          Clear highlight
        </button>
      )}

      {insights.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Findings</div>
            <div className="flex gap-1.5">
              {(['critical', 'warning', 'info'] as const).map(s => counts[s] > 0 && (
                <span key={s} className="text-[9px] px-1.5 rounded-full font-semibold"
                  style={{ background: `${SEVERITY_COLORS[s]}18`, color: SEVERITY_COLORS[s] }}>
                  {counts[s]}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 mb-4">
            {insights.map(i => {
              const color = SEVERITY_COLORS[i.severity]
              const isActive = active?.id === i.id
              return (
                <button key={i.id} onClick={() => onOpen(i)}
                  className="w-full text-left rounded-lg p-2.5 cursor-pointer transition-colors"
                  style={{
                    background: isActive ? '#0F172A' : '#0A0F1A',
                    border: `1px solid ${isActive ? color : '#1E293B'}`,
                  }}>
                  <div className="flex items-start gap-2">
                    <div style={{
                      width: '6px', height: '6px', borderRadius: i.severity === 'critical' ? '1px' : '50%',
                      background: color, flexShrink: 0, marginTop: '4px',
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-white leading-snug">{i.title}</div>
                      <div className="text-[10px] mt-1 leading-relaxed" style={{ color: '#94A3B8' }}>{i.narrative}</div>
                      {i.valueAtRisk !== undefined && (
                        <span className="inline-block text-[9px] mt-1.5 px-1.5 py-0.5 rounded font-semibold tabular-nums"
                          style={{ background: `${color}15`, color }}>
                          {fmtK(i.valueAtRisk)}
                        </span>
                      )}
                      {isActive && i.action && (
                        <div className="text-[9px] mt-1.5 pt-1.5 italic" style={{ color: '#64748B', borderTop: '1px solid #1E293B' }}>
                          {i.action}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <StakeholderCard title="Key suppliers" icon={<Building2 size={11} />}
        rows={topSuppliers} nodes={nodes} onSelectNode={onSelectNode} />
      <StakeholderCard title="Contract owners" icon={<User size={11} />}
        rows={topOwners} nodes={nodes} onSelectNode={onSelectNode} />
    </div>
  )
}

function StakeholderCard({ title, icon, rows, nodes, onSelectNode }: {
  title: string
  icon: React.ReactNode
  rows: { key: string; name: string; weightedDegree: number; departmentReach: number; systemicScore: number }[]
  nodes: GraphNode[]
  onSelectNode: (n: GraphNode) => void
}) {
  if (rows.length === 0) return null
  const totalSpend = nodes.filter(n => n.type === 'contract').reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0)
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color: '#475569' }}>{icon}</span>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>{title}</div>
      </div>
      <div className="space-y-1">
        {rows.map(r => {
          const node = nodes.find(n => n.key === r.key)
          const impact = node ? assessImpact(node, totalSpend) : null
          return (
            <button key={r.key} onClick={() => node && onSelectNode(node)}
              className="w-full text-left rounded-lg p-2 cursor-pointer hover:border-[#334155] transition-colors"
              style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-white truncate">{r.name}</span>
                <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: '#38BDF8' }}>
                  {fmtK(r.weightedDegree)}
                </span>
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>
                {impact ? `${impact.contractCount} contract${impact.contractCount === 1 ? '' : 's'} · ` : ''}
                {r.departmentReach} dept{r.departmentReach === 1 ? '' : 's'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ContractDetail({ node, onNavigate }: { node: GraphNode; onNavigate: (type: string, name: string) => void }) {
  const c = node.contract!
  const risk = riskScore(node)
  const level = riskLevel(risk)
  const reasons = riskReasons(node)

  return (
    <div className="p-4">
      <div className="mb-3">
        <h2 className="font-semibold text-sm text-white leading-tight">{c.name}</h2>
        <div className="flex items-center gap-2 mt-1.5">
          <RiskBadge level={level} score={risk} />
          {c.status && (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#1E293B', color: '#94A3B8' }}>
              {c.status}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard label="Annual Value" value={fmtK(c.annualValue ?? 0)} color="#38BDF8" />
        <MetricCard label="Days to Expiry"
          value={c.endDate ? (() => { const d = daysDiff(c.endDate!); return d < 0 ? `−${-d}d` : `${d}d` })() : '—'}
          color={c.endDate && daysDiff(c.endDate) < 30 ? '#FF0055' : c.endDate && daysDiff(c.endDate) < 90 ? '#F59E0B' : '#10B981'} />
      </div>

      <div className="space-y-0 mb-3">
        <DetailRow label="Start" value={fmtDate(c.startDate)} />
        <DetailRow label="End" value={fmtDate(c.endDate)} />
        <DetailRow label="Notice period" value={c.noticePeriodDays ? `${c.noticePeriodDays} days` : '—'} />
        <DetailRow label="Auto-renew" value={c.autoRenew === true ? 'Yes' : c.autoRenew === false ? 'No' : '—'} />
      </div>

      <div className="space-y-1.5 mb-3">
        <ChipLink icon={<Building2 size={11} />} label="Supplier" value={c.supplier} type="supplier" onClick={() => onNavigate('supplier', c.supplier)} />
        <ChipLink icon={<Tag size={11} />} label="Category" value={c.category} type="category" onClick={() => onNavigate('category', c.category)} />
        <ChipLink icon={<Building2 size={11} />} label="Department" value={c.department} type="department" onClick={() => onNavigate('department', c.department)} />
        <ChipLink icon={<User size={11} />} label="Owner" value={c.owner || '⚠ No owner'} type="owner" onClick={c.owner ? () => onNavigate('owner', c.owner!) : undefined}
          warn={!c.owner} />
      </div>

      {reasons.length > 0 && (
        <div className="rounded-lg p-2.5 mt-3" style={{ background: `${RISK_COLORS[level]}08`, border: `1px solid ${RISK_COLORS[level]}20` }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} color={RISK_COLORS[level]} />
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: RISK_COLORS[level] }}>RISK FACTORS</span>
          </div>
          <div className="space-y-1">
            {reasons.map((r, i) => (
              <div key={i} className="text-[10px] flex items-start gap-1.5" style={{ color: '#94A3B8' }}>
                <span style={{ color: RISK_COLORS[level] }}>•</span>{r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EntityDetail({ node, nodes, onSelect, contracts, focusNode, onFocus }: {
  node: GraphNode; nodes: GraphNode[]
  onSelect: (n: GraphNode) => void
  contracts: any[]
  focusNode: GraphNode | null
  onFocus: (n: GraphNode | null) => void
}) {
  const totalSpend = contracts.reduce((s: number, c: any) => s + (c.annualValue ?? 0), 0)
  const impact = assessImpact(node, totalSpend)
  const isFocused = focusNode?.key === node.key

  return (
    <div className="p-4">
      <div className="mb-3">
        <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: NODE_COLORS[node.type] }}>
          {node.type}
        </div>
        <h2 className="font-semibold text-sm text-white">{node.name}</h2>
      </div>

      <button onClick={() => onFocus(isFocused ? null : node)}
        className="w-full mb-3 text-[10px] py-1.5 rounded-lg cursor-pointer transition-colors hover:text-white"
        style={{
          background: isFocused ? '#1E293B' : '#0F172A',
          border: `1px solid ${isFocused ? '#38BDF8' : '#1E293B'}`,
          color: isFocused ? '#38BDF8' : '#94A3B8',
        }}>
        {isFocused ? 'Exit focus' : 'Focus on this node'}
      </button>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard label="Total Spend" value={fmtK(node.value)} color="#38BDF8" />
        <MetricCard label="Contracts" value={String(node.contracts.length)} color="#94A3B8" />
      </div>

      {impact.contractCount > 0 && (
        <div className="rounded-lg p-2.5 mb-3" style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} color="#D97706" />
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: '#D97706' }}>
              IMPACT IF LOST
            </span>
          </div>
          <div className="text-[10px] leading-relaxed" style={{ color: '#94A3B8' }}>
            {impact.contractCount} contract{impact.contractCount === 1 ? '' : 's'} worth{' '}
            <span className="font-semibold" style={{ color: '#E2E8F0' }}>{fmtK(impact.annualValue)}</span>
            {' '}({Math.round(impact.spendShare * 100)}% of portfolio) would need replacing.
          </div>
          {impact.departments.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>
                Departments affected ({impact.departments.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {impact.departments.map(d => (
                  <span key={d} className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {['department', 'category', 'supplier', 'owner'].map(t => {
        if (t === node.type) return null
        const items = [...node.neighbors].filter(n => n.type === t)
        if (items.length === 0) return null
        return (
          <div key={t} className="mb-3">
            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>{t}s</div>
            <div className="flex flex-wrap gap-1">
              {items.map(n => (
                <button key={n.key}
                  className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors inline-flex items-center gap-1.5"
                  style={{
                    background: '#0F172A',
                    border: `1px solid ${NODE_COLORS[t]}40`,
                    color: '#CBD5E1',
                  }}
                  onClick={() => onSelect(n)}>
                  <span style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: NODE_COLORS[t], display: 'inline-block',
                  }} />
                  {n.name}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#475569' }}>
          Contracts ({node.contracts.length})
        </div>
        <div className="space-y-1">
          {node.contracts.slice(0, 25).map(c => {
            const cn = nodes.find(n => n.type === 'contract' && n.contract?.id === c.id)
            const risk = cn ? riskScore(cn) : 0
            const level = riskLevel(risk)
            return (
              <button key={c.id}
                className="w-full text-left rounded-lg p-2 cursor-pointer hover:border-[#334155] transition-colors"
                style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}
                onClick={() => { if (cn) onSelect(cn) }}>
                <div className="flex items-start justify-between">
                  <div className="text-[10px] font-medium text-white leading-tight">{c.name}</div>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: RISK_COLORS[level], flexShrink: 0, marginTop: '3px' }} />
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>
                  {c.supplier} · {fmtK(c.annualValue ?? 0)}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RiskBadge({ level, score }: { level: string; score: number }) {
  const color = RISK_COLORS[level as keyof typeof RISK_COLORS]
  const Icon = level === 'high' ? AlertTriangle : level === 'medium' ? Shield : ShieldCheck
  return (
    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
      style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
      <Icon size={10} color={color} />
      <span className="text-[9px] font-semibold" style={{ color }}>{level.toUpperCase()} · {score}</span>
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
      <div className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: '#475569' }}>{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid #0F172A' }}>
      <span className="text-[10px]" style={{ color: '#64748B' }}>{label}</span>
      <span className="text-[10px] text-white">{value}</span>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid #0F172A' }}>
      <span style={{ color: '#475569' }}>{icon}</span>
      <span className="flex-1 text-[10px]" style={{ color: '#64748B' }}>{label}</span>
      <span className="text-[11px] font-semibold text-white tabular-nums">{value}</span>
    </div>
  )
}

function ChipLink({ icon, label, value, onClick, warn, type }: {
  icon: React.ReactNode; label: string; value: string
  onClick?: () => void; warn?: boolean
  /** Entity type — colours the chip to match its link in the graph. */
  type?: string
}) {
  // Same hue the graph paints the link to this entity, so panel and web share
  // one visual language.
  const hue = warn ? '#F59E0B' : (type && NODE_COLORS[type]) || '#38BDF8'
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: '#475569' }}>{icon}</span>
      <span className="text-[9px]" style={{ color: '#64748B' }}>{label}:</span>
      {onClick ? (
        <button className="text-[10px] cursor-pointer hover:underline transition-colors inline-flex items-center gap-1.5"
          style={{ color: hue }} onClick={onClick}>
          <span style={{ width: '6px', height: '2px', borderRadius: '1px', background: hue, display: 'inline-block' }} />
          {value}
        </button>
      ) : (
        <span className="text-[10px] inline-flex items-center gap-1.5" style={{ color: hue }}>
          <span style={{ width: '6px', height: '2px', borderRadius: '1px', background: hue, display: 'inline-block' }} />
          {value}
        </span>
      )}
    </div>
  )
}
