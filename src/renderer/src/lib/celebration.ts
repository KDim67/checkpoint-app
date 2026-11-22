import { getBoolSetting, setBoolSetting } from './settings'
import { prefersReducedMotion } from './presence'
import { useAppStore } from '../store/appStore'

function notifyToast(text: string, options?: { action?: { label: string; onClick: () => void }; duration?: number }) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('checkpoint-toast', { detail: { text, ...options } }))
}

const CONFETTI_COLORS = ['#00d2ff', '#ff007f', '#ffd700', '#00e676', '#7c4dff', '#ff6d00', '#00f5d4']
const PARTICLE_COUNT = 45

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  shape: 'rect' | 'circle' | 'strip'
  rotation: number
  vRot: number
  alpha: number
  decay: number
}

let activeParticles: Particle[] = []
let animFrameId: number | null = null
let canvasEl: HTMLCanvasElement | null = null

function getCelebrationCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (!canvasEl || !document.body.contains(canvasEl)) {
    canvasEl = document.createElement('canvas')
    canvasEl.id = 'checkpoint-celebration-canvas'
    canvasEl.style.position = 'fixed'
    canvasEl.style.inset = '0'
    canvasEl.style.width = '100vw'
    canvasEl.style.height = '100vh'
    canvasEl.style.pointerEvents = 'none'
    canvasEl.style.zIndex = '99999'
    document.body.appendChild(canvasEl)
  }
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth * dpr
  const h = window.innerHeight * dpr
  if (canvasEl.width !== w || canvasEl.height !== h) {
    canvasEl.width = w
    canvasEl.height = h
  }
  return canvasEl
}

function renderFrame() {
  const canvas = getCelebrationCanvas()
  if (!canvas) {
    activeParticles = []
    animFrameId = null
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    activeParticles = []
    animFrameId = null
    return
  }

  const dpr = window.devicePixelRatio || 1
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const remaining: Particle[] = []
  for (const p of activeParticles) {
    p.x += p.vx
    p.y += p.vy
    p.vy += 0.28 // gravity
    p.vx *= 0.985 // drag
    p.rotation += p.vRot
    p.alpha -= p.decay

    if (p.alpha > 0 && p.y < window.innerHeight + 50) {
      remaining.push(p)

      ctx.save()
      ctx.globalAlpha = Math.max(0, p.alpha)
      ctx.translate(p.x * dpr, p.y * dpr)
      ctx.rotate(p.rotation)
      ctx.fillStyle = p.color

      const s = p.size * dpr
      if (p.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (p.shape === 'strip') {
        ctx.fillRect(-s, -s / 3, s * 2, s / 1.5)
      } else {
        ctx.fillRect(-s / 2, -s / 2, s, s)
      }
      ctx.restore()
    }
  }

  activeParticles = remaining

  if (activeParticles.length > 0) {
    animFrameId = requestAnimationFrame(renderFrame)
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    animFrameId = null
  }
}

/** spawns a celebratory confetti burst at the given position or center screen */
export async function triggerConfetti(origin?: { x: number; y: number } | DOMRect | null): Promise<void> {
  if (prefersReducedMotion()) return

  const enabled = await getBoolSetting('completion_celebrations_enabled', true)
  if (!enabled) return

  // notify user on first completion that this can be toggled in settings
  const alreadyNotified = await getBoolSetting('completion_celebrations_notified', false)
  if (!alreadyNotified) {
    await setBoolSetting('completion_celebrations_notified', true)
    notifyToast('Task completed! You can turn off celebrations in Settings.', {
      action: {
        label: 'Take me there',
        onClick: () => {
          useAppStore.getState().setSettingsTab('general')
          useAppStore.getState().setView('settings')
        }
      },
      duration: 7000
    })
  }

  let startX = window.innerWidth / 2
  let startY = window.innerHeight * 0.45

  if (origin) {
    if ('left' in origin && 'top' in origin && 'width' in origin && 'height' in origin) {
      startX = origin.left + origin.width / 2
      startY = origin.top + origin.height / 2
    } else if ('x' in origin && 'y' in origin) {
      startX = origin.x
      startY = origin.y
    }
  }

  const shapes: Particle['shape'][] = ['rect', 'circle', 'strip']
  const newParticles: Particle[] = []

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.random() * 140 + 200) * (Math.PI / 180) // 200° to 340° (upwards spread)
    const speed = Math.random() * 8 + 4
    newParticles.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 3,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 6 + 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.25,
      alpha: 1,
      decay: Math.random() * 0.012 + 0.012
    })
  }

  activeParticles = [...activeParticles, ...newParticles]

  if (animFrameId === null) {
    animFrameId = requestAnimationFrame(renderFrame)
  }
}
