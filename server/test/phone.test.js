import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone } from '../src/phone.js'

test('numéros normalisés en E.164', () => {
  assert.equal(normalizePhone('034 12 345 67'), '+261341234567')
  assert.equal(normalizePhone('+261 34 12 345 67'), '+261341234567')
  assert.equal(normalizePhone('00261341234567'), '+261341234567')
  assert.equal(normalizePhone('06.12.34.56.78', 'FR'), '+33612345678')
  assert.equal(normalizePhone('(+33) 6 12 34 56 78'), '+33612345678')
})

test('numéros invalides refusés', () => {
  for (const v of ['', '12', '0341234', 'abc', '+0123456789', '+1234567', '0' + '1'.repeat(30), 123, null]) {
    assert.throws(() => normalizePhone(v), { status: 400 }, String(v))
  }
  assert.throws(() => normalizePhone('034 12 345 67', 'XX'), { status: 400 })
})
