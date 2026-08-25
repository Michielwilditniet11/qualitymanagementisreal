import { X, ArrowRight } from 'lucide-react'
import { T } from '../../ui'
import { NODE_COLORS } from '../../graph/buildGraph'
import type { FocusFrame } from '../../analytics/focusFrame'
import type { GraphNode } from '../../data/types'

/**
 * The answer to "why am I looking at this". A frame without a card is a camera
 * move; with one it is an explanation, which is the whole point of the change.
 *
 * Also used by story mode, so narration and frames never drift apart.
 */
export default function FrameCard({
  frame, nodes, onSelect, onClose, onCrossLink, step,
}: {
  frame: FocusFrame
  nodes: GraphNode[]
  onSelect: (n: GraphNode) => void
  onClose: () => void
  onCrossLink?: (target: 'calendar' | 'diagnostics') => void
  /** Story mode position, e.g. "3 / 7". */
  step?: string
}) {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  // Members worth naming: the subjects, then the hubs they run through.
  const chips = [...frame.seedKeys, ...frame.contextKeys]
    .map(k => byKey.get(k))
    .filter((n): n is GraphNode => Boolean(n))
    .slice(0, 10)
  const seedSet = new Set(frame.seedKeys)
  const hiddenCount = frame.seedKeys.length + frame.contextKeys.length - chips.length

  return (
    <div className="absolute z-20 rounded-sm"
      style={{
        left: '12px', bottom: '12px', maxWidth: '380px',
        background: 'rgba(4,7,14,0.96)', border: `1px solid ${T.hairlineBright}`,
        backdropFilter: 'blur(12px)', boxShadow: '0 0 28px rgba(0,0,0,0.55)',
      }}>
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[8px] tracking-[0.2em] mb-1" style={{ color: T.cyan, fontFamily: T.mono }}>
            {step ? `${step} · IN FOCUS` : 'IN FOCUS'}
          </div>
          <div className="text-[12px] font-semibold leading-snug" style={{ color: T.text }}>
            {frame.title}
          </div>
        </div>
        {frame.figure && (
          <span className="text-[13px] font-bold tabular-nums flex-shrink-0"
            style={{ color: T.amber, fontFamily: T.mono }}>{frame.figure}</span>
        )}
        <button onClick={onClose} aria-label="Clear focus"
          className="flex-shrink-0 cursor-pointer -mt-0.5 hover:brightness-150"
          style={{ color: T.muted }}>
          <X size={13} />
        </button>
      </div>

      <div className="px-3 pt-1.5 text-[11px] leading-relaxed" style={{ color: T.dim }}>
        {frame.caption}
      </div>

      {chips.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-1">
          {chips.map(n => (
            <button key={n.key} onClick={() => onSelect(n)}
              className="text-[9px] px-1.5 py-0.5 cursor-pointer transition-colors hover:brightness-150 truncate"
              style={{
                maxWidth: '160px', fontFamily: T.mono,
                background: seedSet.has(n.key) ? `${NODE_COLORS[n.type]}22` : T.panel,
                border: `1px solid ${seedSet.has(n.key) ? NODE_COLORS[n.type] : T.hairline}`,
                color: seedSet.has(n.key) ? NODE_COLORS[n.type] : T.muted,
              }}>
              {n.name}
            </button>
          ))}
          {hiddenCount > 0 && (
            <span className="text-[9px] px-1 py-0.5" style={{ color: T.faint, fontFamily: T.mono }}>
              +{hiddenCount} more
            </span>
          )}
        </div>
      )}

      {/* How to read what is on screen right now. */}
      <div className="px-3 pt-2 pb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-[8px] tracking-wider" style={{ color: T.faint, fontFamily: T.mono }}>
          ○ RINGED = SUBJECT
        </span>
        {frame.legend.slice(0, 4).map(l => (
          <span key={l.meaning} className="text-[8px] flex items-center gap-1" style={{ color: T.faint }}>
            <span style={{ width: '10px', height: '2px', background: l.color, display: 'inline-block' }} />
            {l.meaning}
          </span>
        ))}
      </div>

      {(frame.nextStep || frame.crossLinks.length > 0) && (
        <div className="px-3 py-2 mt-1" style={{ borderTop: `1px solid ${T.hairline}` }}>
          {frame.nextStep && (
            <div className="text-[10px] flex items-start gap-1.5 mb-1.5" style={{ color: T.cyan }}>
              <span style={{ color: T.faint, fontFamily: T.mono }}>NEXT:</span>
              <span style={{ color: T.dim }}>{frame.nextStep}</span>
            </div>
          )}
          {frame.crossLinks.length > 0 && onCrossLink && (
            <div className="flex gap-1.5">
              {frame.crossLinks.map(c => (
                <button key={c.target} onClick={() => onCrossLink(c.target)}
                  className="text-[9px] tracking-wider px-1.5 py-0.5 cursor-pointer inline-flex items-center gap-1 hover:brightness-150"
                  style={{ border: `1px solid ${T.hairlineBright}`, color: T.cyan, fontFamily: T.mono }}>
                  {c.label.toUpperCase()} <ArrowRight size={9} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
