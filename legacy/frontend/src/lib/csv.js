/**
 * CSV export.
 *
 * Values are quoted and internal quotes doubled, per RFC 4180. A value that
 * starts with =, +, - or @ is prefixed with a single quote: spreadsheets treat
 * those as formulas, and a patient name like "-Ana" should not execute.
 */

function escapeCell(value) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.get(row))).join(','),
  )
  return [header, ...body].join('\r\n')
}

export function downloadCsv(filename, columns, rows) {
  // BOM so Excel reads UTF-8 names correctly.
  const blob = new Blob(['﻿', toCsv(columns, rows)], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
