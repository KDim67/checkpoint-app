import type { HardwareSpecs, CatalogModel, FitResult, QuantizationLevel, FitStatus } from './cookbookTypes'

/**
 * Evaluates hardware specs against a catalog model to calculate fit status,
 * score (0-100), and recommended quantization level.
 *
 * CRITICAL: This is a pure logic file. Do not import any Node.js core libraries (fs, os, etc.)
 * so that Vite can load it directly in the React frontend.
 */
export function calculateFitResult(specs: HardwareSpecs, model: CatalogModel): FitResult {
  const quantizations: QuantizationLevel[] = ['q4', 'q8', 'f16']
  let bestVariantName: QuantizationLevel | undefined = undefined

  // 1. Determine best candidate variant fitting in RAM (needs 25% headroom for OS)
  const maxAvailableRam = specs.ramGb * 0.75
  for (const q of quantizations) {
    const variant = model.variants[q]
    if (variant && variant.ramRequiredGb <= maxAvailableRam) {
      bestVariantName = q
    }
  }

  // 6. If no variant can fit in system RAM, return not_recommended immediately
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

  // 2. Determine GPU viability
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

  // 3. Calculate base score (0 - 100)
  let score = 100

  // Subtract for lowest quantization downgrade
  if (bestVariantName === 'q4') {
    score -= 20
  }

  // Subtract for CPU offloading or pure CPU inference
  if (!gpuViable) {
    if (canOffload) {
      score -= 30
    } else {
      score -= 55
    }
  }

  // RAM headroom bonus (if user has double the required RAM, add 10)
  if (specs.ramGb >= bestVariant.ramRequiredGb * 2) {
    score += 10
  }

  // Clamp final score to [0, 100]
  score = Math.max(0, Math.min(100, score))

  // 4. Determine FitStatus
  let status: FitStatus = 'not_recommended'
  if (score >= 80) status = 'optimal'
  else if (score >= 55) status = 'tight'
  else if (score >= 25) status = 'cpu_offload'
  else status = 'not_recommended'

  // 5. Build reason string
  let reason = ''
  switch (status) {
    case 'optimal':
      reason = `Runs natively on GPU (${specs.gpuName || 'GPU'}) at ${bestVariantName.toUpperCase()} quantization with sufficient VRAM headroom.`
      break
    case 'tight':
      reason = `GPU-capable at ${bestVariantName.toUpperCase()} but with less than 10% VRAM headroom. Performance may vary under load.`
      break
    case 'cpu_offload':
      reason = `Insufficient VRAM for full GPU inference. Model will run with CPU offloading, expect 3–8x slower generation.`
      break
    case 'not_recommended':
    default:
      reason = `System RAM or VRAM insufficient for any supported quantization of this model.`
      break
  }

  return {
    status,
    score,
    reason,
    recommendedVariant: bestVariantName
  }
}
