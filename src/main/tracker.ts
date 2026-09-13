import { spawn, ChildProcess } from 'child_process'
import { powerMonitor, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { getContextSlugs, getSetting, insertActivityLog } from './db'

let trackerProcess: ChildProcess | null = null
let trackerTimer: NodeJS.Timeout | null = null

let currentWindowProcess = ''
let currentWindowTitle = ''
let currentWindowContext = ''
let currentWindowDuration = 0

function flushBuffer(): void {
  if (currentWindowDuration <= 0) return
  try {
    insertActivityLog(
      currentWindowContext,
      currentWindowTitle,
      currentWindowProcess,
      currentWindowDuration
    )
  } catch (err) {
    console.error('[Tracker] Failed to flush activity log to database:', err)
  }
  currentWindowDuration = 0
}

function handleTrackerTick(line: string): void {
  // idle after 300s
  try {
    const idleTime = powerMonitor.getSystemIdleTime()
    if (idleTime > 300) {
      // idle: flush and skip this tick
      flushBuffer()
      return
    }
  } catch (err) {
    console.error('[Tracker] Failed to get system idle time:', err)
  }

  const parts = line.split('|||')
  const processName = (parts[0] || '').trim()
  const windowTitle = (parts[1] || '').trim()

  if (!processName && !windowTitle) {
    return
  }

  // map process/window names to contexts
  let tickContext = ''
  try {
    const contexts = getContextSlugs()
    const searchStr = `${processName} ${windowTitle}`.toLowerCase()
    const matched = contexts.find(slug => searchStr.includes(slug.toLowerCase()))
    
    if (matched) {
      tickContext = matched
    } else {
      // fall back to the active context
      tickContext = getSetting<string>('active_context', 'default')
    }
  } catch (err) {
    console.error('[Tracker] Failed to resolve context slugs:', err)
    tickContext = 'default'
  }

  const windowChanged =
    processName !== currentWindowProcess ||
    windowTitle !== currentWindowTitle ||
    tickContext !== currentWindowContext

  if (windowChanged) {
    flushBuffer()
    currentWindowProcess = processName
    currentWindowTitle = windowTitle
    currentWindowContext = tickContext
    currentWindowDuration = 5000
  } else {
    currentWindowDuration += 5000
    if (currentWindowDuration >= 30000) {
      flushBuffer()
      // keep the window info, reset duration for the next chunk
      currentWindowProcess = processName
      currentWindowTitle = windowTitle
      currentWindowContext = tickContext
    }
  }
}

export function initializeActivityTracker(): void {
  const isEnabled = getSetting<string>('feature_tracker', 'false') === 'true'
  if (!isEnabled) {
    return
  }

  // no duplicate starts
  if (trackerProcess || trackerTimer) {
    return
  }

  console.log('[Tracker] Initializing Passive Activity Tracker...')

  const isWindows = process.platform === 'win32'
  if (isWindows) {
    try {
      const userDataPath = app.getPath('userData')
      const scriptPath = path.join(userDataPath, 'active_window_watcher.ps1')
      const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sig = @'
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]
public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
[DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
'@
$type = Add-Type -MemberDefinition $sig -Name 'Win32' -Namespace 'Win32Utils' -PassThru
while ($true) {
    try {
        $hwnd = $type::GetForegroundWindow()
        if ($hwnd -ne [IntPtr]::Zero) {
            $pid = 0
            [void]$type::GetWindowThreadProcessId($hwnd, [ref]$pid)
            $sb = New-Object System.Text.StringBuilder 256
            [void]$type::GetWindowText($hwnd, $sb, 256)
            $title = $sb.ToString()
            $procName = ""
            if ($pid -gt 0) {
                $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($p) { $procName = $p.ProcessName }
            }
            Write-Host "$procName|||$title"
        } else {
            Write-Host "|||"
        }
    } catch {}
    Start-Sleep -Seconds 5
}
`
      fs.writeFileSync(scriptPath, scriptContent, 'utf8')

      trackerProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      trackerProcess.stdout?.setEncoding('utf8')
      let stdoutBuffer = ''
      trackerProcess.stdout?.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        // drop the buffer past 64KB with no newline
        if (stdoutBuffer.length > 65536) {
          console.warn('[Tracker] stdout buffer overflow, discarding')
          stdoutBuffer = ''
        }
        let newlineIndex: number
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.substring(0, newlineIndex).trim()
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1)
          if (line) {
            handleTrackerTick(line)
          }
        }
      })

      trackerProcess.on('error', (err) => {
        console.error('[Tracker] Daemon process error:', err)
      })

      trackerProcess.on('exit', (code) => {
        console.log(`[Tracker] Daemon process exited with code ${code}`)
      })
    } catch (err) {
      console.error('[Tracker] Failed to launch PowerShell window tracker:', err)
    }
  } else {
    // macOS/Linux stub
    console.log('[Tracker] Spawning macOS/Linux activity tracking stub interval')
    trackerTimer = setInterval(() => {
      handleTrackerTick('mock-app|||Mock Active Window')
    }, 5000)
  }
}

export function shutdownActivityTracker(): void {
  console.log('[Tracker] Shutting down Passive Activity Tracker (Hard Stop)...')
  
  flushBuffer()

  if (trackerProcess) {
    try {
      trackerProcess.kill()
    } catch (err) {
      console.error('[Tracker] Error killing daemon process:', err)
    }
    trackerProcess = null
  }

  if (trackerTimer) {
    clearInterval(trackerTimer)
    trackerTimer = null
  }

  currentWindowProcess = ''
  currentWindowTitle = ''
  currentWindowContext = ''
  currentWindowDuration = 0
}

export function getTrackerState(): boolean {
  return trackerProcess !== null || trackerTimer !== null
}

export function toggleTracker(active: boolean): void {
  if (active) {
    initializeActivityTracker()
  } else {
    shutdownActivityTracker()
  }
}
