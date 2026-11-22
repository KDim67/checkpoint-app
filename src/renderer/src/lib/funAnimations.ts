/**
 * Lightweight overlay animations for fun commands (dice, coin, etc).
 * Renders a brief CSS-animated element center-screen, then cleans up.
 */

import { prefersReducedMotion } from './presence'

let overlayEl: HTMLDivElement | null = null

function getOverlay(): HTMLDivElement {
  if (overlayEl && document.body.contains(overlayEl)) return overlayEl
  overlayEl = document.createElement('div')
  overlayEl.id = 'checkpoint-fun-overlay'
  Object.assign(overlayEl.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '99998',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  })
  document.body.appendChild(overlayEl)
  return overlayEl
}

function injectStyles(): void {
  if (document.getElementById('fun-anim-styles')) return
  const style = document.createElement('style')
  style.id = 'fun-anim-styles'
  style.textContent = `
    @keyframes fun-dice-tumble {
      0%   { transform: scale(0.3) rotate(0deg); opacity: 0; }
      15%  { transform: scale(1.3) rotate(80deg); opacity: 1; }
      30%  { transform: scale(1.1) rotate(200deg); }
      50%  { transform: scale(1.2) rotate(360deg); }
      70%  { transform: scale(1.0) rotate(500deg); }
      85%  { transform: scale(1.15) rotate(640deg); }
      100% { transform: scale(1.0) rotate(720deg); opacity: 1; }
    }
    @keyframes fun-dice-resolve {
      0%   { transform: scale(1.0); opacity: 1; }
      50%  { transform: scale(1.4); opacity: 1; }
      100% { transform: scale(0); opacity: 0; }
    }
    @keyframes fun-coin-spin {
      0%   { transform: scale(0.3) rotateY(0deg); opacity: 0; }
      15%  { transform: scale(1.2) rotateY(180deg); opacity: 1; }
      30%  { transform: scale(1.0) rotateY(360deg); }
      50%  { transform: scale(1.1) rotateY(720deg); }
      70%  { transform: scale(1.0) rotateY(1080deg); }
      85%  { transform: scale(1.05) rotateY(1260deg); }
      100% { transform: scale(1.0) rotateY(1440deg); opacity: 1; }
    }
    @keyframes fun-coin-resolve {
      0%   { transform: scale(1.0) rotateY(0); opacity: 1; }
      50%  { transform: scale(1.3) rotateY(0); opacity: 1; }
      100% { transform: scale(0) rotateY(0); opacity: 0; }
    }
    @keyframes fun-pop-in {
      0%   { transform: scale(0); opacity: 0; }
      60%  { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1.0); opacity: 1; }
    }
    .fun-anim-dice {
      font-size: 72px;
      line-height: 1;
      filter: drop-shadow(0 4px 24px rgba(0,0,0,0.5));
      animation: fun-dice-tumble 850ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      user-select: none;
      pointer-events: none;
    }
    .fun-anim-dice[data-resolve] {
      animation: fun-dice-resolve 350ms ease-in forwards;
    }
    .fun-anim-coin {
      font-size: 80px;
      line-height: 1;
      filter: drop-shadow(0 4px 24px rgba(0,0,0,0.5));
      perspective: 400px;
      animation: fun-coin-spin 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      user-select: none;
      pointer-events: none;
    }
    .fun-anim-coin[data-resolve] {
      animation: fun-coin-resolve 350ms ease-in forwards;
    }
    .fun-anim-result {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 2px 12px rgba(0,0,0,0.6);
      animation: fun-pop-in 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      user-select: none;
      pointer-events: none;
      position: absolute;
      white-space: nowrap;
    }
  `
  document.head.appendChild(style)
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

const DICE_FACES: Record<number, string> = {
  1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅'
}

/** Plays a tumbling dice animation, returns the rolled values */
export async function animateDiceRoll(): Promise<{ d6: number; d20: number }> {
  const d6 = Math.floor(Math.random() * 6) + 1
  const d20 = Math.floor(Math.random() * 20) + 1

  if (prefersReducedMotion() || typeof document === 'undefined') {
    return { d6, d20 }
  }

  injectStyles()
  const overlay = getOverlay()

  // tumble phase: cycle through dice faces
  const el = document.createElement('div')
  el.className = 'fun-anim-dice'
  el.textContent = '🎲'
  overlay.appendChild(el)

  // rapid face cycling during the tumble
  const faces = Object.values(DICE_FACES)
  let frame = 0
  const cycleId = setInterval(() => {
    el.textContent = faces[frame % faces.length]
    frame++
  }, 70)

  await delay(850)
  clearInterval(cycleId)

  // land on actual face
  el.textContent = DICE_FACES[d6] || '🎲'
  await delay(200)

  // show d20 result text briefly
  const resultEl = document.createElement('div')
  resultEl.className = 'fun-anim-result'
  resultEl.style.marginTop = '100px'
  const isCrit = d20 === 20
  const isFumble = d20 === 1
  resultEl.textContent = isCrit ? `d20: ${d20} — CRIT! 🔥` : isFumble ? `d20: ${d20} — Miss! 💀` : `d20: ${d20}`
  overlay.appendChild(resultEl)

  await delay(600)

  // resolve out
  el.setAttribute('data-resolve', '')
  resultEl.style.animation = 'fun-dice-resolve 350ms ease-in forwards'
  await delay(350)

  el.remove()
  resultEl.remove()

  return { d6, d20 }
}

/** Plays a spinning coin animation, returns the outcome */
export async function animateCoinFlip(): Promise<string> {
  const outcome = Math.random() < 0.5 ? 'Heads' : 'Tails'

  if (prefersReducedMotion() || typeof document === 'undefined') {
    return outcome
  }

  injectStyles()
  const overlay = getOverlay()

  const el = document.createElement('div')
  el.className = 'fun-anim-coin'
  el.textContent = '🪙'
  overlay.appendChild(el)

  await delay(900)

  // show result
  const resultEl = document.createElement('div')
  resultEl.className = 'fun-anim-result'
  resultEl.style.marginTop = '110px'
  resultEl.textContent = outcome === 'Heads' ? '👑 Heads!' : '🌙 Tails!'
  overlay.appendChild(resultEl)

  await delay(700)

  // resolve out
  el.setAttribute('data-resolve', '')
  resultEl.style.animation = 'fun-coin-resolve 350ms ease-in forwards'
  await delay(350)

  el.remove()
  resultEl.remove()

  return outcome
}
