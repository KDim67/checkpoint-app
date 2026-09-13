import { execFileAsync } from './exec'
import os from 'os'
import si from 'systeminformation'
import type { HardwareSpecs, GpuVendor } from '../shared/cookbookTypes'


export async function getHardwareSpecs(): Promise<HardwareSpecs> {
  // defaults if detection fails
  let ramGb = Math.round((os.totalmem() / 1073741824) * 10) / 10
  let cpuCores = 4
  let cpuThreads = os.cpus().length || 4
  let gpuVendor: GpuVendor = 'unknown'
  let gpuName = 'Generic GPU'
  let vramGb = 0

  try {
    const cpuInfo = await si.cpu()
    if (cpuInfo) {
      cpuCores = cpuInfo.physicalCores || cpuCores
      cpuThreads = cpuInfo.cores || cpuThreads
    }
  } catch (err) {
    console.warn('Profiler: Failed to fetch CPU physical cores from systeminformation:', err)
  }

  let gpuDetected = false

  // tier 1: nvidia-smi, NVIDIA only
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
    // not NVIDIA or not on PATH, try tier 2
  }

  // tier 2: WMI for AMD/Intel on windows
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

        // WMI AdapterRAM caps/wraps at 4GB, only nvidia-smi gets bigger cards right
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
      // WMI failed, try tier 3
    }
  }

  // tier 3: systeminformation, cross-platform
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
