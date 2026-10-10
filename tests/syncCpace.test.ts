import { describe, expect, it } from 'vitest'
import {
  calculateGenerator,
  confirmationTags,
  generatorString,
  intermediateKey,
  lvCat,
  prependLen,
  sampleScalar,
  scalarFromBytes,
  scalarMult,
  scalarMultVfy,
  transcriptIr
} from '../src/shared/cpace'

// every expected value below is from draft-irtf-cfrg-cpace-21, appendices A.1, A.3.5 and B.3
const hex = (text: string): Buffer => Buffer.from(text.replace(/\s+/g, ''), 'hex')
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

const PRS = Buffer.from('Password')
const CI = hex('0b415f696e69746961746f720b425f726573706f6e646572')
const SID = hex('7e4b4791d6a8ef019b936c79fb7f2c57')
const ya = scalarFromBytes(hex('da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08'))
const yb = scalarFromBytes(hex('d2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d'))
const YA = 'd6bac480f2c386c394efc7c47adb9925dcd2630b64f240c50f8d0eec482b9157'
const YB = '3ea7e0b19560d7c0b0f5734f63b955286dfa8232b5ebe63324e2d9e7433f7258'
const K = '80b69a8a76457ab6a4d7f887a4bf6b55a2f80ac19c333f917a05fc9887c8b40f'

describe('the string encodings CPace hashes', () => {
  it('prepend a LEB128 length', () => {
    expect(toHex(prependLen(Buffer.alloc(0)))).toBe('00')
    expect(toHex(prependLen(Buffer.from('1234')))).toBe('0431323334')
    expect(toHex(prependLen(Buffer.from(Array.from({ length: 127 }, (_, i) => i)))).slice(0, 4)).toBe('7f00')
    expect(toHex(prependLen(Buffer.from(Array.from({ length: 128 }, (_, i) => i)))).slice(0, 6)).toBe('800100')
  })

  it('concatenate length and value, and order a transcript initiator first', () => {
    expect(toHex(lvCat(Buffer.from('1234'), Buffer.from('5'), Buffer.alloc(0), Buffer.from('678')))).toBe('043132333401350003363738')
    expect(toHex(transcriptIr(Buffer.from('123'), Buffer.from('PartyA'), Buffer.from('234'), Buffer.from('PartyB'))))
      .toBe('03313233065061727479410332333406506172747942')
  })
})

describe('CPace on ristretto255 with SHA-512', () => {
  it('derives the generator from the code, channel and session', () => {
    expect(toHex(generatorString(PRS, CI, SID))).toBe(toHex(hex(`
      11435061636552697374726574746f3235350850617373776f726464
      00000000000000000000000000000000000000000000000000000000
      00000000000000000000000000000000000000000000000000000000
      00000000000000000000000000000000000000000000000000000000
      00000000000000000000000000000000180b415f696e69746961746f
      720b425f726573706f6e646572107e4b4791d6a8ef019b936c79fb7f
      2c57`)))
    expect(toHex(calculateGenerator(PRS, CI, SID).toBytes())).toBe('222b6b195fe84b1652badb6f6a3ae3d24341e7306967f0b8115b40d5698c7e56')
  })

  it('makes each side its message and both the same point', () => {
    const g = calculateGenerator(PRS, CI, SID)
    expect(toHex(scalarMult(ya, g))).toBe(YA)
    expect(toHex(scalarMult(yb, g))).toBe(YB)
    expect(toHex(scalarMultVfy(ya, hex(YB)) ?? Buffer.alloc(0))).toBe(K)
    expect(toHex(scalarMultVfy(yb, hex(YA)) ?? Buffer.alloc(0))).toBe(K)
  })

  it('derives the session key from the point and the transcript', () => {
    const isk = intermediateKey(SID, hex(K), transcriptIr(hex(YA), Buffer.from('ADa'), hex(YB), Buffer.from('ADb')))
    expect(toHex(isk)).toBe('b69effbf61b51d56401c0f65601abe428de8206feaaf0e32198896dcae7b35cd2b38950a39dfd5d4a79164614c2984f7daa460b588c1e80c3fa2068af7900447')
  })

  it('multiplies a valid point, and refuses one that does not decode or is the identity', () => {
    const s = scalarFromBytes(hex('7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05'))
    expect(toHex(scalarMultVfy(s, hex('2c3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c')) ?? Buffer.alloc(0)))
      .toBe('7c13645fe790a468f62c39beb7388e541d8405d1ade69d1778c5fe3e7f6b600e')
    expect(scalarMultVfy(s, hex('2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c'))).toBeNull()
    expect(scalarMultVfy(s, Buffer.alloc(32))).toBeNull()
  })

  it('samples scalars below 2^252 and never zero', () => {
    for (let i = 0; i < 50; i++) {
      const s = sampleScalar()
      expect(s > 0n && s < 2n ** 252n).toBe(true)
    }
  })

  it('confirms only with the same key, each side over its own message', () => {
    const tags = confirmationTags(SID, hex('01'.repeat(64)), hex(YA), Buffer.alloc(0), hex(YB), Buffer.alloc(0))
    const other = confirmationTags(SID, hex('02'.repeat(64)), hex(YA), Buffer.alloc(0), hex(YB), Buffer.alloc(0))
    expect(toHex(tags.a)).not.toBe(toHex(tags.b))
    expect(toHex(tags.a)).not.toBe(toHex(other.a))
    expect(tags.a).toHaveLength(64)
  })
})
