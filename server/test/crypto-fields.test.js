import test from 'node:test'
import assert from 'node:assert/strict'
import { sealField, openField, blindIndex } from '../src/crypto-fields.js'

const KEY = 'cd'.repeat(32), OTHER = 'ef'.repeat(32)

test('chiffrement des champs : aller-retour, IV aléatoire, rien en clair', () => {
  const a = sealField('Fy', KEY, 'children:first_name:1'), b = sealField('Fy', KEY, 'children:first_name:1')
  assert.notDeepEqual(a, b)
  assert.ok(!a.includes(Buffer.from('Fy')))
  assert.equal(openField(a, KEY, 'children:first_name:1'), 'Fy')
  assert.equal(openField(sealField('Tiana 🌸', KEY, 'x'), KEY, 'x'), 'Tiana 🌸')
})

test('chiffrement des champs : autre ligne, autre clé, altération ou format inconnu refusés', () => {
  const sealed = sealField('Fy', KEY, 'children:first_name:1')
  assert.throws(() => openField(sealed, KEY, 'children:first_name:2'))
  assert.throws(() => openField(sealed, OTHER, 'children:first_name:1'))
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1
  assert.throws(() => openField(tampered, KEY, 'children:first_name:1'))
  const otherVersion = Buffer.from(sealed); otherVersion[0] = 2
  assert.throws(() => openField(otherVersion, KEY, 'children:first_name:1'))
  assert.throws(() => openField(Buffer.alloc(10), KEY, 'children:first_name:1'))
})

test('index aveugle : stable, propre à l’usage et à la clé, sans la valeur en clair', () => {
  const a = blindIndex('+261341234567', KEY, 'phone')
  assert.deepEqual(a, blindIndex('+261341234567', KEY, 'phone'))
  assert.notDeepEqual(a, blindIndex('+261341234568', KEY, 'phone'))
  assert.notDeepEqual(a, blindIndex('+261341234567', KEY, 'autre-usage'))
  assert.notDeepEqual(a, blindIndex('+261341234567', OTHER, 'phone'))
  assert.equal(a.length, 32)
  assert.ok(!a.includes(Buffer.from('261341234567')))
})
