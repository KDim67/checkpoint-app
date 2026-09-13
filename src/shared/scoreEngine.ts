import type { HardwareSpecs, CatalogModel, FitResult, QuantizationLevel, FitStatus } from './cookbookTypes'

/** pure, no Node imports, so Vite can load it in the renderer */
/** the rest belongs to the OS and other apps */
export const USABLE_RAM_FRACTION = 0.75

export function calculateFitResult(specs: HardwareSpecs, model: CatalogModel): FitResult {
  const quantizations: QuantizationLevel[] = ['q4', 'q8', 'f16']
  let bestVariantName: QuantizationLevel | undefined = undefined

  // best variant that fits usable RAM
  const maxAvailableRam = specs.ramGb * USABLE_RAM_FRACTION
  for (const q of quantizations) {
    const variant = model.variants[q]
    if (variant && variant.ramRequiredGb <= maxAvailableRam) {
      bestVariantName = q
    }
  }

  // nothing fits, not recommended
  if (!bestVariantName) {
    return {
      status: 'not_recommended',
      score: 0,
      reason: 'Insufficient system RAM for any quantization of this model.',
      recommendedVariant: 'q4'
    }
  }

  const bestVariant = model.variants[bestVariantName]
  if (!bestVariant) {
    return {
      status: 'not_recommended',
      score: 0,
      reason: 'No installable quantization is available for this model.',
      recommendedVariant: 'q4'
    }
  }

  let gpuViable = false
  let canOffload = false

  if (specs.vramGb >= bestVariant.vramRequiredGb * 1.1) {
    gpuViable = true
  } else if (specs.vramGb > 0 && specs.vramGb >= bestVariant.vramRequiredGb * 0.5) {
    gpuViable = false
    canOffload = true
  } else {
    gpuViable = false
    canOffload = false
  }

  let score = 100

  // q4 downgrade penalty
  if (bestVariantName === 'q4') {
    score -= 20
  }

  // CPU offload penalty
  if (!gpuViable) {
    if (canOffload) {
      score -= 30
    } else {
      score -= 55
    }
  }

  // bonus for double the needed RAM
  if (specs.ramGb >= bestVariant.ramRequiredGb * 2) {
    score += 10
  }

  score = Math.max(0, Math.min(100, score))

  // capped by execution mode; the RAM bonus used to outweigh no GPU and claim GPU execution
  let status: FitStatus = 'not_recommended'
  if (score >= 80) status = 'optimal'
  else if (score >= 55) status = 'tight'
  else if (score >= 25) status = 'cpu_offload'
  else status = 'not_recommended'

  // optimal and tight both claim GPU
  if (!gpuViable && (status === 'optimal' || status === 'tight')) {
    status = score >= 25 ? 'cpu_offload' : 'not_recommended'
  }

  // keyed off execution mode so it never describes absent hardware
  let reason = ''
  if (status === 'not_recommended') {
    reason = `System RAM or VRAM insufficient for any supported quantization of this model.`
  } else if (gpuViable) {
    reason = status === 'optimal'
      ? `Runs natively on GPU (${specs.gpuName || 'GPU'}) at ${bestVariantName.toUpperCase()} quantization with sufficient VRAM headroom.`
      : `GPU-capable at ${bestVariantName.toUpperCase()} but with less than 10% VRAM headroom. Performance may vary under load.`
  } else if (canOffload) {
    reason = `Insufficient VRAM for full GPU inference. Model will run with CPU offloading. Expect 3–8x slower generation.`
  } else {
    reason = `No usable GPU memory detected. Model will run on the CPU at ${bestVariantName.toUpperCase()}. Expect 3–8x slower generation.`
  }

  return {
    status,
    score,
    reason,
    recommendedVariant: bestVariantName
  }
}
