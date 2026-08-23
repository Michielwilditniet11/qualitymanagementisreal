import { useState, useCallback } from 'react'
import { parseFile, parseCSVText, guessMapping, buildDataset, TARGET_FIELDS, FIELD_LABELS } from '../../data/parser'
import { SAMPLE_CSV } from '../../data/sample'
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
          <button onClick={loadSample} className="bg-[#1d2639] border border-[#2a3650] text-[#8fa0bd] px-5 py-3 rounded-lg hover:text-white transition text-sm">
            Load sample dataset
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/30 border border-red-500/40 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {headers.length > 0 && (
        <>
          <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-5 mb-6">
            <h3 className="font-semibold mb-1">Column mapping</h3>
            <p className="text-[#8fa0bd] text-xs mb-4">{mappedCount} of {TARGET_FIELDS.length} fields mapped · {rows.length} data rows detected</p>
            <div className="grid grid-cols-2 gap-3">
              {TARGET_FIELDS.map(field => (
                <div key={field} className="flex items-center gap-2">
                  <label className="text-sm w-40 text-[#8fa0bd]">{FIELD_LABELS[field] ?? field}</label>
                  <select
                    value={mapping[field] ?? -1}
                    onChange={e => updateMapping(field, parseInt(e.target.value))}
                    className="flex-1 bg-[#0f1420] border border-[#2a3650] rounded-lg px-2 py-1.5 text-sm text-white"
                  >
                    <option value={-1}>— not mapped —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-5 mb-6 overflow-x-auto">
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

          <button onClick={handleImport} className="bg-[#4da3ff] text-[#08101f] font-semibold px-6 py-3 rounded-xl hover:brightness-110 transition text-sm">
            Import {rows.length} contracts →
          </button>
        </>
      )}
    </div>
  )
}
