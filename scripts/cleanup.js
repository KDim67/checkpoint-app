import { exec } from 'child_process'
import os from 'os'

const platform = os.platform()

if (platform === 'win32') {
  // Gracefully kill any running Electron instances on Windows
  exec('taskkill /f /im electron.exe /fi "status eq running"', () => {
    process.exit(0)
  })
} else {
  // Gracefully kill on macOS/Linux
  exec('pkill -f electron', () => {
    process.exit(0)
  })
}
