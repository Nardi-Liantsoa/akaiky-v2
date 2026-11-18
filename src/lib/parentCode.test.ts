import { describe, expect, it } from 'vitest'
import { parentCodeProblem } from './parentCode'

describe('parentCodeProblem', () => {
  it('accepte six chiffres sans motif évident', () => {
    for (const code of ['482915', '120934', '135790', '000001']) expect(parentCodeProblem(code)).toBeNull()
  })
  it('refuse ce qui n’est pas exactement six chiffres ASCII', () => {
    for (const code of ['', '12345', '1234567', '12 345', 'abcdef', '١٢٣٤٥٦', ' 482915']) expect(parentCodeProblem(code)).toBe('invalid_parent_code')
  })
  it('refuse les chiffres identiques et les suites', () => {
    for (const code of ['000000', '777777', '123456', '456789', '654321', '987654', '012345', '901234', '890123', '121212', '123123', '112233', '998877', '111222', '123321', '482284']) expect(parentCodeProblem(code)).toBe('weak_parent_code')
  })
})
