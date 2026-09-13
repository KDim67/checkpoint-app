import { exec } from 'child_process'
import os from 'os'

const platform = os.platform()

if (platform === 'win32') {
  exec('taskkill /f /im electron.exe /fi "status eq running"', () => {
    process.exit(0)
  })
} else {
  exec('pkill -f electron', () => {
    process.exit(0)
  })
}
