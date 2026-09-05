import type { HardwareSpecs, CatalogModel, FitResult, QuantizationLevel, FitStatus } from './cookbookTypes'

/**
 * Evaluates hardware specs against a catalog model to calculate fit status,
 * score (0-100), and recommended quantization level.
 *
 * CRITICAL: This is a pure logic file. Do not import any Node.js core libraries (fs, os, etc.)
 * so that Vite can load it directly in the React frontend.
 */
/**
 * How much of the installed RAM a model is allowed to claim. The rest belongs
 * to the operating system and to whatever else the machine is running.
 */
export const USABLE_RAM_FRACTION = 0.75

export function calculateFitResult(specs: HardwareSpecs, model: CatalogModel): FitResult {
  const quantizations: QuantizationLevel[] = ['q4', 'q8', 'f16']
  let bestVariantName: QuantizationLevel | undefined = undefined

  // 1. Determine best candidate variant fitting in RAM (needs 25% headroom for OS)
  const maxAvailableRam = specs.ramGb * USABLE_RAM_FRACTION
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
  //
  // Capped by the execution mode decided in step 2. Deriving it from the score
  // alone let the +10 RAM headroom bonus outweigh the GPU penalty, so a machine
  // with plenty of RAM and no usable VRAM landed in a bracket whose text claims
  // GPU execution, and users choose a model on the strength of that sentence.
  let status: FitStatus = 'not_recommended'
  if (score >= 80) status = 'optimal'
  else if (score >= 55) status = 'tight'
  else if (score >= 25) status = 'cpu_offload'
  else status = 'not_recommended'

  // Both 'optimal' and 'tight' assert the model runs on the GPU, so neither can
  // survive a verdict of not-GPU-viable however high the score climbed.
  if (!gpuViable && (status === 'optimal' || status === 'tight')) {
    status = score >= 25 ? 'cpu_offload' : 'not_recommended'
  }

  // 5. Build reason string.
  //
  // Keyed off the execution mode rather than the status bracket, so the text can
  // never describe hardware the machine does not have. Partial offload and pure
  // CPU share the 'cpu_offload' status but are not the same claim.
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
