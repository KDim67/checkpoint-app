import { execFile } from 'child_process'
import os from 'os'
import si from 'systeminformation'
import type { HardwareSpecs, GpuVendor } from '../shared/cookbookTypes'

/**
 * Runs an executable command with arguments and returns stdout,
 * guarded by an AbortController timeout to prevent hang.
 */
function execFileAsync(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const { signal } = controller

    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error(`Exec timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    execFile(file, args, { signal }, (error, stdout) => {
      clearTimeout(timeout)
      if (error) {
        reject(error)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

export async function getHardwareSpecs(): Promise<HardwareSpecs> {
  // Safe default values
  let ramGb = Math.round((os.totalmem() / 1073741824) * 10) / 10
  let cpuCores = 4
  let cpuThreads = os.cpus().length || 4
  let gpuVendor: GpuVendor = 'unknown'
  let gpuName = 'Generic GPU'
  let vramGb = 0

  // 1. Get exact CPU specs via systeminformation
  try {
    const cpuInfo = await si.cpu()
    if (cpuInfo) {
      cpuCores = cpuInfo.physicalCores || cpuCores
      cpuThreads = cpuInfo.cores || cpuThreads
    }
  } catch (err) {
    console.warn('Profiler: Failed to fetch CPU physical cores from systeminformation:', err)
  }

  // 2. Multi-tier GPU Vendor & VRAM Detection
  let gpuDetected = false

  // --- Tier 1: nvidia-smi (Windows & Linux, NVIDIA only) ---
  try {
    const stdout = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      3000
    )
    if (stdout) {
      const parts = stdout.split('\n')[0].split(',')
      const name = parts[0]?.trim()
      const totalMiB = parseFloat(parts[1]?.trim())

      if (name && !isNaN(totalMiB)) {
        gpuVendor = 'nvidia'
        gpuName = name
        vramGb = Math.round((totalMiB / 1024) * 10) / 10
        gpuDetected = true
      }
    }
  } catch {
    // nvidia-smi fails if not NVIDIA or command not found in PATH; fallback to Tier 2
  }

  // --- Tier 2: PowerShell WMI (Windows AMD/Intel fallback) ---
  if (!gpuDetected && process.platform === 'win32') {
    try {
      const psCommand =
        'Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json'
      const stdout = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psCommand],
        3000
      )
      if (stdout) {
        const data = JSON.parse(stdout)
        const name = data.Name || ''
        const rawRam = data.AdapterRAM

        // WMI AdapterRAM is 32-bit signed/unsigned int and often wraps/caps at 4GB (4294967295 bytes)
        // for larger modern GPUs. Tier 1 must succeed for correct VRAM numbers above 4GB.
        const bytes = Math.abs(Number(rawRam || 0))
        const detectedVram = Math.round((bytes / 1073741824) * 10) / 10

        let detectedVendor: GpuVendor = 'unknown'
        const lowerName = name.toLowerCase()
        if (lowerName.includes('nvidia')) detectedVendor = 'nvidia'
        else if (lowerName.includes('amd') || lowerName.includes('radeon')) detectedVendor = 'amd'
        else if (lowerName.includes('intel')) detectedVendor = 'intel'
        else if (lowerName.includes('apple')) detectedVendor = 'apple'

        if (detectedVendor !== 'unknown') {
          gpuVendor = detectedVendor
          gpuName = name
          vramGb = detectedVram
          gpuDetected = true
        }
      }
    } catch {
      // WMI/PowerShell failed; fallback to Tier 3
    }
  }

  // --- Tier 3: systeminformation graphics fallback (cross-platform) ---
  if (!gpuDetected) {
    try {
      const graphics = await si.graphics()
      if (graphics && graphics.controllers && graphics.controllers.length > 0) {
        const ctrl = graphics.controllers[0]
        gpuName = ctrl.model || gpuName
        vramGb = ctrl.vram ? Math.round((ctrl.vram / 1024) * 10) / 10 : vramGb

        const vendorLower = (ctrl.vendor || ctrl.model || '').toLowerCase()
        if (vendorLower.includes('nvidia')) gpuVendor = 'nvidia'
        else if (vendorLower.includes('amd') || vendorLower.includes('radeon')) gpuVendor = 'amd'
        else if (vendorLower.includes('intel')) gpuVendor = 'intel'
        else if (vendorLower.includes('apple')) gpuVendor = 'apple'
        gpuDetected = true
      }
    } catch (err) {
      console.warn('Profiler: Failed to fetch GPU info from systeminformation:', err)
    }
  }

  return {
    ramGb,
    cpuCores,
    cpuThreads,
    gpuVendor,
    gpuName,
    vramGb,
    platform: process.platform
  }
}
