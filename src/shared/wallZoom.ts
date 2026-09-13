/** keyboard zoom: fixed levels to step through, centred on the view */

import { MAX_ZOOM, MIN_ZOOM, toWallPoint, type WallCamera } from './wallModel'

/** round numbers people recognise in the percentage beside the toolbar */
export const ZOOM_STEPS = [MIN_ZOOM, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, MAX_ZOOM]

/** the next level that way; from between two levels, the nearer one in that direction */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find(step => step > zoom + 0.001) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find(step => step < zoom - 0.001) ?? MIN_ZOOM
}

/** the wall under the middle of the view stays there; the same camera when the zoom can't change */
export function zoomToward(camera: WallCamera, viewport: { width: number; height: number }, zoom: number): WallCamera {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  if (next === camera.zoom) return camera
  const centre = { x: viewport.width / 2, y: viewport.height / 2 }
  const at = toWallPoint(centre, camera)
  return { zoom: next, x: centre.x - at.x * next, y: centre.y - at.y * next }
}
