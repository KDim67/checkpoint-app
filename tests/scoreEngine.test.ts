import { describe, it, expect } from 'vitest'
import { calculateFitResult, USABLE_RAM_FRACTION } from '../src/shared/scoreEngine'
import type { HardwareSpecs, CatalogModel, ModelVariant, QuantizationLevel } from '../src/shared/types'

function specs(overrides: Partial<HardwareSpecs> = {}): HardwareSpecs {
  return {
    ramGb: 32,
    cpuCores: 8,
    cpuThreads: 16,
    gpuVendor: 'nvidia',
    gpuName: 'RTX 4070',
    vramGb: 12,
    platform: 'win32',
    ...overrides
  }
}

function variant(q: QuantizationLevel, ramRequiredGb: number, vramRequiredGb: number): ModelVariant {
  return { quantization: q, ramRequiredGb, vramRequiredGb, fileSizeGb: ramRequiredGb, ollamaTag: `m:${q}` }
}

function model(variants: CatalogModel['variants']): CatalogModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    family: 'test',
    parameters: 7,
    description: '',
    useCases: [],
    homepageUrl: '',
    variants
  }
}

describe('calculateFitResult', () => {
  it('reserves a quarter of system RAM for the OS when choosing a quantization', () => {
    // 16 GB machine => 12 GB usable. q8 needs 12 (fits exactly), f16 needs 13 (does not).
    const result = calculateFitResult(
      specs({ ramGb: 16, vramGb: 24 }),
      model({ q4: variant('q4', 6, 5), q8: variant('q8', 12, 10), f16: variant('f16', 13, 12) })
    )
    expect(result.recommendedVariant).toBe('q8')
  })

  it('prefers the highest quantization that still fits rather than the smallest', () => {
    const result = calculateFitResult(
      specs({ ramGb: 128, vramGb: 48 }),
      model({ q4: variant('q4', 6, 5), q8: variant('q8', 12, 10), f16: variant('f16', 24, 20) })
    )
    expect(result.recommendedVariant).toBe('f16')
    expect(result.status).toBe('optimal')
  })

  it('scores zero when not even the smallest quantization fits in RAM', () => {
    const result = calculateFitResult(
      specs({ ramGb: 8, vramGb: 24 }),
      model({ q4: variant('q4', 40, 30) })
    )
    expect(result).toMatchObject({ status: 'not_recommended', score: 0, recommendedVariant: 'q4' })
    expect(result.reason).toMatch(/Insufficient system RAM/)
  })

  it('scores zero when the catalog entry ships no quantizations at all', () => {
    const result = calculateFitResult(specs(), model({}))
    expect(result).toMatchObject({ status: 'not_recommended', score: 0 })
  })

  it('demands 10 percent VRAM headroom before calling a model GPU-native', () => {
    const board = model({ q8: variant('q8', 8, 10) })

    // Exactly the requirement is not enough. The headroom rule needs 11 GB.
    const justShort = calculateFitResult(specs({ ramGb: 32, vramGb: 10 }), board)
    const justEnough = calculateFitResult(specs({ ramGb: 32, vramGb: 11 }), board)

    expect(justShort.score).toBeLessThan(justEnough.score)
    expect(justEnough.status).toBe('optimal')
  })

  it('never reports a score outside 0..100', () => {
    // GPU-native f16 with double the RAM needed would total 110 before clamping.
    const result = calculateFitResult(
      specs({ ramGb: 256, vramGb: 80 }),
      model({ f16: variant('f16', 24, 20) })
    )
    expect(result.score).toBe(100)
  })

  it('penalises a q4-only model even on hardware that runs it natively', () => {
    const q4Only = calculateFitResult(
      specs({ ramGb: 32, vramGb: 24 }),
      model({ q4: variant('q4', 6, 5) })
    )
    const q8Also = calculateFitResult(
      specs({ ramGb: 32, vramGb: 24 }),
      model({ q4: variant('q4', 6, 5), q8: variant('q8', 8, 7) })
    )
    expect(q4Only.score).toBeLessThan(q8Also.score)
  })

  it('drops a GPU-less machine below the GPU-capable tiers', () => {
    const result = calculateFitResult(
      specs({ ramGb: 32, vramGb: 0, gpuVendor: 'unknown', gpuName: '' }),
      model({ q4: variant('q4', 6, 5) })
    )
    // 100 - 20 (q4) - 55 (no GPU at all) + 10 (RAM headroom) = 35
    expect(result.score).toBe(35)
    expect(result.status).toBe('cpu_offload')
  })

  // Known defect
  // The reason string is chosen from the numeric score alone, but the score mixes
  // the RAM-headroom bonus in with the GPU penalty. A machine with plenty of RAM
  // can therefore out-earn its own GPU penalty and be told it runs "natively on
  // GPU" when the engine already decided it cannot. Reported, not worked around.
  it('never claims native GPU execution on hardware that has no GPU', () => {
    const result = calculateFitResult(
      specs({ ramGb: 64, vramGb: 0, gpuVendor: 'unknown', gpuName: '' }),
      model({ q8: variant('q8', 12, 10) })
    )
    expect(result.reason).not.toMatch(/GPU-capable|Runs natively on GPU/)
  })

  it('never claims full GPU inference on hardware the engine routed to CPU offload', () => {
    const result = calculateFitResult(
      specs({ ramGb: 64, vramGb: 6 }),
      model({ q4: variant('q4', 8, 5), q8: variant('q8', 12, 10) })
    )
    expect(result.reason).not.toMatch(/Runs natively on GPU/)
  })

  // The Cookbook prints this fraction at the user as "a model can use about
  // N GB of it". If the engine and the constant ever part company, that line
  // becomes a lie, so pin the constant to what the engine actually does.
  it('applies exactly the RAM fraction it exports', () => {
    const ramGb = 32
    const budget = ramGb * USABLE_RAM_FRACTION

    const atBudget = calculateFitResult(
      specs({ ramGb, vramGb: 48 }),
      model({ q4: variant('q4', budget, 4) })
    )
    expect(atBudget.status).not.toBe('not_recommended')

    const overBudget = calculateFitResult(
      specs({ ramGb, vramGb: 48 }),
      model({ q4: variant('q4', budget + 0.1, 4) })
    )
    expect(overBudget.status).toBe('not_recommended')
  })
})
