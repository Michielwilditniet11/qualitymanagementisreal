import { useState, useCallback, useMemo } from 'react'
import { parseFile, parseCSVText, guessMapping, buildDataset, rowsToContracts, TARGET_FIELDS, FIELD_LABELS } from '../../data/parser'
import { SAMPLE_CSV } from '../../data/sample'
import { T } from '../../ui'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import type { ColumnMapping } from '../../data/types'

export default function UploadScreen() {
  const setDataset = useDataStore(s => s.setDataset)
  const setView = useUIStore(s => s.setView)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const handleParsed = useCallback((h: string[], r: string[][], name: string) => {
    setHeaders(h)
    setRows(r)
    setFileName(name)
    setMapping(guessMapping(h))
    setError('')
  }, [])

  const handleFile = useCallback(async (file: File) => {
    try {
      const { headers: h, rows: r } = await parseFile(file)
      handleParsed(h, r, file.name)
    } catch (e: any) {
      setError(e.message)
    }
  }, [handleParsed])

  const loadSample = useCallback(() => {
    const { headers: h, rows: r } = parseCSVText(SAMPLE_CSV)
    handleParsed(h, r, 'Sample dataset (55 contracts)')
  }, [handleParsed])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleImport = useCallback(() => {
    if (rows.length === 0) return
    const ds = buildDataset(headers, rows, mapping, fileName)
    setDataset(ds)
    setView('web')
  }, [headers, rows, mapping, fileName, setDataset, setView])

  /**
   * What the parser will complain about under the current mapping. It has
   * always produced these; nothing ever read them, so an import with
   * unparseable dates or duplicate ids looked identical to a clean one.
   */
  const issuePreview = useMemo(() => {
    if (rows.length === 0) return []
    const { issues } = rowsToContracts(rows, mapping)
    const byField = new Map<string, { field: string; kind: string; count: number; example: string }>()
    for (const i of issues) {
      const k = `${i.field}|${i.kind}`
      const hit = byField.get(k)
      if (hit) hit.count++
      else byField.set(k, { field: i.field, kind: i.kind, count: 1, example: i.detail })
    }
    return [...byField.values()].sort((a, b) => b.count - a.count)
  }, [rows, mapping])

  const updateMapping = (field: string, colIdx: number) => {
    setMapping(m => {
      const next = { ...m }
      if (colIdx === -1) { delete next[field] } else { next[field] = colIdx }
      return next
    })
  }

  const mappedCount = TARGET_FIELDS.filter(f => mapping[f] !== undefined).length

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Import procurement data</h2>
      <p className="text-[#8fa0bd] mb-6 text-sm">Upload your ERP export (CSV or XLSX). All processing happens in your browser — your data never leaves your machine.</p>

      <div className="flex gap-4 mb-6">
        {/* Drop zone */}
        <div
          className={`flex-1 border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer
            ${dragging ? 'border-[#4da3ff] bg-[#4da3ff10]' : 'border-[#2a3650] hover:border-[#4da3ff]'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('fileInput')?.click()}
        >
          <div className="text-4xl mb-3">📂</div>
          <div className="font-semibold">Drop CSV / XLSX here</div>
          <div className="text-[#8fa0bd] text-sm mt-1">or click to browse</div>
          <input id="fileInput" type="file" accept=".csv,.tsv,.xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
        <div className="flex flex-col gap-3">
          <button onClick={loadSample} className="px-4 py-2.5 rounded-sm text-[11px] tracking-wider transition-colors hover:brightness-125">
            Load sample dataset
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/30 border border-red-500/40 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {headers.length > 0 && (
        <>
          <div className="rounded-sm bg-[#080D18] border border-[#16233A] p-5 mb-6">
            <h3 className="font-semibold mb-1">Column mapping</h3>
            <p className="text-[#8fa0bd] text-xs mb-4">{mappedCount} of {TARGET_FIELDS.length} fields mapped · {rows.length} data rows detected</p>
            <div className="grid grid-cols-2 gap-3">
              {TARGET_FIELDS.map(field => (
                <div key={field} className="flex items-center gap-2">
                  <label className="text-sm w-40 text-[#8fa0bd]">{FIELD_LABELS[field] ?? field}</label>
                  <select
                    value={mapping[field] ?? -1}
                    onChange={e => updateMapping(field, parseInt(e.target.value))}
                    className="flex-1 rounded-sm px-2 py-1 text-[11px]" style={{ background: "#04070E", border: "1px solid #16233A", color: "#E6EDF6"}} data-x=""
                  >
                    <option value={-1}>— not mapped —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-sm bg-[#080D18] border border-[#16233A] p-5 mb-6 overflow-x-auto">
            <h3 className="font-semibold mb-3">Preview (first 10 rows)</h3>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const mapped = Object.entries(mapping).find(([, v]) => v === i)
                    return <th key={i} className={`text-left p-1.5 border-b border-[#2a3650] ${mapped ? 'text-[#4da3ff]' : 'text-[#8fa0bd]'}`}>
                      {h}{mapped ? ` → ${FIELD_LABELS[mapped[0]] ?? mapped[0]}` : ''}
                    </th>
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j} className="p-1.5 border-b border-[#2a3650]/50 text-[#8fa0bd]">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {issuePreview.length > 0 && (
            <div className="mb-4 rounded-sm" style={{ background: T.panel, border: `1px solid ${T.hairline}` }}>
              <div className="px-3 py-2 text-[9px] tracking-[0.18em]"
                style={{ color: T.amber, fontFamily: T.mono, borderBottom: `1px solid ${T.hairline}` }}>
                WHAT THIS IMPORT IS MISSING
              </div>
              <div className="p-3 space-y-1">
                {issuePreview.map(i => (
                  <div key={`${i.field}|${i.kind}`} className="flex items-baseline gap-2 text-[10px]">
                    <span className="tabular-nums font-semibold flex-shrink-0"
                      style={{ color: i.kind === 'missing' ? T.amber : T.red, fontFamily: T.mono, minWidth: '34px' }}>
                      {i.count}
                    </span>
                    <span style={{ color: T.dim }}>
                      {FIELD_LABELS[i.field] ?? i.field} — {i.kind}
                    </span>
                    <span className="truncate italic" style={{ color: T.faint }}>{i.example}</span>
                  </div>
                ))}
                <div className="text-[9px] pt-1.5 italic" style={{ color: T.muted }}>
                  You can still import. Every total will understate reality by whatever is
                  missing here, and the Data lens will show you where.
                </div>
              </div>
            </div>
          )}

          <button onClick={handleImport} className="font-semibold px-5 py-2.5 rounded-sm text-[11px] tracking-wider hover:brightness-110 transition"
            style={{ background: T.cyan, color: T.ground, fontFamily: T.mono }}>
            Import {rows.length} contracts →
          </button>
        </>
      )}
    </div>
  )
}
