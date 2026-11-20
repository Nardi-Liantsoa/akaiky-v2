import { test } from 'node:test'
import assert from 'node:assert/strict'
import { report, violations } from './check-migrations-frozen.mjs'

test('migrations figées : ajout accepté, modification, suppression et renommage refusés', () => {
  const diff = [
    'A\tserver/src/migrations/027_nouvelle.sql',
    'M\tserver/src/migrations/023_allowed_apps.sql',
    'D\tserver/src/migrations/002_drop_notes.sql',
    'T\tserver/src/migrations/005_children.sql',
    'M\tserver/src/db.js',
    'M\tserver/src/migrations-notes.md'
  ].join('\n')
  assert.deepEqual(violations(diff), [
    { status: 'M', path: 'server/src/migrations/023_allowed_apps.sql' },
    { status: 'D', path: 'server/src/migrations/002_drop_notes.sql' },
    { status: 'T', path: 'server/src/migrations/005_children.sql' }
  ])
  assert.deepEqual(violations('A\tserver/src/migrations/027_nouvelle.sql\n'), [])
  assert.deepEqual(violations(''), [])
})

test('migrations figées : le message nomme le fichier et dit quoi faire', () => {
  const text = report([{ status: 'M', path: 'server/src/migrations/023_allowed_apps.sql' }], 'origin/main')
  assert.match(text, /023_allowed_apps\.sql \(modifiée\)/)
  assert.match(text, /nouvelle migration numérotée/)
})
