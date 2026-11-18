import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from './audit.mjs'

// Forme réduite du rapport `npm audit --json` (auditReportVersion 2) : un avis
// direct (objet dans via) et une dépendance qui le remonte (chaîne).
const report = (...advisories) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries([
    ...advisories.map((a) => [a.name, { name: a.name, severity: a.severity, via: [a] }]),
    ['vite', { name: 'vite', severity: 'high', via: advisories.map((a) => a.name) }]
  ])
})
const picomatch = { source: 1, name: 'picomatch', severity: 'high', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }
const exception = { id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', reason: 'outillage seul', added: '2026-11-18', expires: '2026-12-18' }

test('avis listé, exception valable : vert', () => {
  assert.deepEqual(evaluate(report(picomatch), [exception], '2026-11-18'), { ok: true, problems: [] })
  assert.equal(evaluate(report(picomatch), [exception], '2026-12-18').ok, true)
})

test('avis non listé (moderate ou plus) : rouge', () => {
  const other = { source: 2, name: 'esbuild', severity: 'moderate', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }
  const r = evaluate(report(picomatch, other), [exception], '2026-11-18')
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /GHSA-AAAA-BBBB-CCCC sur esbuild/)
})

test('avis listé pour un autre paquet : rouge', () => {
  const r = evaluate(report({ ...picomatch, name: 'minimatch' }), [exception], '2026-11-18')
  assert.equal(r.ok, false)
})

test('avis low : non bloquant', () => {
  const low = { source: 3, name: 'debug', severity: 'low', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff' }
  assert.equal(evaluate(report(picomatch, low), [exception], '2026-11-18').ok, true)
})

test('exception expirée : rouge', () => {
  const r = evaluate(report(picomatch), [exception], '2026-12-19')
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /expirée le 2026-12-18/)
})

test('exception sans avis correspondant (version corrigée) : rouge', () => {
  const r = evaluate(report(), [exception], '2026-11-18')
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /devenue inutile/)
})

test('rapport en erreur ou illisible : rouge', () => {
  assert.equal(evaluate({ error: { code: 'ENOAUDIT' } }, [exception], '2026-11-18').ok, false)
  assert.equal(evaluate(null, [exception], '2026-11-18').ok, false)
})

test('exception mal formée : rouge', () => {
  assert.equal(evaluate(report(picomatch), [{ ...exception, expires: undefined }], '2026-11-18').ok, false)
})
