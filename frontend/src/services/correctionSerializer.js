// Correction log serialization — import parser and export builder/downloader.
// Obsidian plugin will reuse these pure functions unchanged; only the download
// trigger (createElement('a').click()) would be replaced by vault.adapter.write().

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Import ───────────────────────────────────────────────────────────────────

export function parseImportRows(text, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const lines = text.replace(/^﻿/, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSVにデータ行がありません');
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = parseCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        const v = values[i] ?? '';
        if (['page', 'save_page', 'occurrence_index', 'candidate_rank'].includes(h)) {
          obj[h] = v === '' ? null : parseInt(v, 10);
        } else if (h === 'is_manual_input') {
          obj[h] = v === 'true' || v === '1';
        } else if (h === 'time_per_correction') {
          obj[h] = v === '' ? 0 : parseFloat(v);
        } else {
          obj[h] = v === 'null' ? null : v;
        }
      });
      return obj;
    });
  } else {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error('JSONは配列形式である必要があります');
    return rows;
  }
}

// ─── Normalize (dedup) ────────────────────────────────────────────────────────

// Deduplicate raw correction entries by span_id (last-wins) and normalize shape.
export function normalizeCorrections(rawEntries) {
  const deduped = Object.values(
    (rawEntries || []).reduce((acc, e) => {
      const key = e.span_id || e.spanId || e.suspect_span;
      return { ...acc, [key]: e };
    }, {})
  );
  return deduped.map(e => ({
    suspect_span: e.suspect_span,
    original_text: e.original_text ?? e.suspect_span,
    selected_candidate: e.chosen ?? e.selected_candidate ?? '',
    candidate_rank: e.candidate_rank,
    is_manual_input: e.is_manual_input,
    time_per_correction: e.time_per_correction ?? 0.0,
    span_id: e.span_id ?? e.spanId ?? '',
    occurrence_index: e.occurrence_index ?? 0,
  }));
}

// ─── Export builders ─────────────────────────────────────────────────────────

export function buildExportRows(pageCorrections, docId, timestamp) {
  const rows = [];
  for (const [pageNumStr, entries] of Object.entries(pageCorrections)) {
    const pageNum = parseInt(pageNumStr, 10);
    const deduped = Object.values(
      (entries || []).reduce((acc, e) => {
        const key = e.span_id || e.spanId || e.suspect_span;
        return { ...acc, [key]: e };
      }, {})
    );
    for (const e of deduped) {
      rows.push({
        doc_id: docId,
        page: pageNum,
        save_page: pageNum,
        span_id: e.span_id ?? e.spanId ?? '',
        occurrence_index: e.occurrence_index ?? 0,
        suspect_span: e.suspect_span ?? '',
        original_text: e.original_text ?? e.suspect_span ?? '',
        selected_candidate: e.chosen ?? e.selected_candidate ?? '',
        candidate_rank: e.candidate_rank ?? -1,
        is_manual_input: e.is_manual_input ?? false,
        time_per_correction: e.time_per_correction ?? 0.0,
        exported_at: timestamp,
        correction_mode: e.correction_mode ?? 'single',
        cleanup_rule: e.cleanup_rule ?? null,
      });
    }
  }
  return rows;
}

export function getExportFilename(docId, ext) {
  const safe = (docId || 'unknown').replace(/[/\\:*?"<>|]/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `correction_log_${safe}_${ts}.${ext}`;
}

// ─── Download triggers (browser-only; replace with vault.adapter.write in plugin) ─

export function downloadAsJson(rows, filename) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CSV_HEADERS = [
  'doc_id', 'page', 'save_page', 'span_id', 'occurrence_index',
  'suspect_span', 'original_text', 'selected_candidate', 'candidate_rank',
  'is_manual_input', 'time_per_correction', 'exported_at', 'correction_mode', 'cleanup_rule',
];

export function downloadAsCsv(rows, filename) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [
    CSV_HEADERS.join(','),
    ...rows.map(row => CSV_HEADERS.map(h => escape(row[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
