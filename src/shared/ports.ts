/**
 * Default localhost ports for the background servers. Both sides of the IPC
 * boundary need them, and a default that disagrees with itself is invisible
 * until something stops working.
 *
 * The webhook gateway had exactly that: main said 9988, the Features toggle
 * said 9374, so flipping the switch silently moved it.
 */

/** Local HTTP gateway for external automation (git hooks, build scripts). */
export const WEBHOOK_DEFAULT_PORT = 9988

/** MCP server for external AI agents. */
export const MCP_DEFAULT_PORT = 9990

/** LAN peer discovery and sync. Not user-configurable. */
export const SYNC_TCP_PORT = 5739
