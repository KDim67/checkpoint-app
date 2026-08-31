/**
 * Default localhost ports for Checkpoint's background servers.
 *
 * Collected here because each of these is needed on both sides of the IPC
 * boundary, main starts the server, the renderer's settings UI toggles it, 
 * and a default that disagrees with itself is invisible until something stops
 * working. The webhook gateway had exactly that: main defaulted to 9988 while
 * the Features toggle passed a hardcoded 9374, so the first time anyone touched
 * that switch the gateway silently moved, and any external script posting to
 * the documented port stopped being delivered with no error anywhere.
 */

/** Local HTTP gateway for external automation (git hooks, build scripts). */
export const WEBHOOK_DEFAULT_PORT = 9988

/** MCP server for external AI agents. */
export const MCP_DEFAULT_PORT = 9990

/** LAN peer discovery and sync. Not user-configurable. */
export const SYNC_TCP_PORT = 5739
