/** the windows that float over the desktop: the tray panel, quick capture and the widget */

/** the address each one loads with, as App routes them */
export const OVERLAY_WINDOWS = ['#hud', '#tray', '#widget']

/** their windows are see-through, so their page has to be too; left dark, it showed as a black block behind the card */
export function markOverlayWindow(hash: string = window.location.hash): void {
  if (OVERLAY_WINDOWS.includes(hash)) document.documentElement.dataset.overlay = 'true'
}
