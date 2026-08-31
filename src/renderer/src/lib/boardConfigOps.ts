/**
 * Re-export shim. The operations moved to `src/shared/boardOps.ts` so the MCP
 * server in the main process can apply the same vocabulary the assistant uses, 
 * `tsconfig.node.json` cannot see `src/renderer`. Kept so renderer imports of
 * this path continue to resolve.
 */
export * from '../../../shared/boardOps'
