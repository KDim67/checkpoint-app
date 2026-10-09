import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'
import { SIGNALING_HOST } from './src/shared/signalingHost'

/** index.html can't import the signaling host; CSP placeholder filled from the constant, build fails if it's gone */
function signalingHostPolicy(): Plugin {
  const placeholder = '%SIGNALING_HOST%'
  return {
    name: 'checkpoint-signaling-host-policy',
    transformIndexHtml(html) {
      if (!html.includes(placeholder)) {
        throw new Error(`index.html has no ${placeholder} in its content security policy`)
      }
      return html.replaceAll(placeholder, SIGNALING_HOST)
    }
  }
}

/** the plugin window's preload runs sandboxed as a plain script; an import in it would only fail at runtime, so fail the build */
function sandboxedPreloadGuard(): Plugin {
  return {
    name: 'checkpoint-sandboxed-preload',
    generateBundle(_options, bundle) {
      const chunk = Object.values(bundle).find(c => c.type === 'chunk' && c.name === 'pluginHost')
      if (!chunk || chunk.type !== 'chunk') throw new Error('the pluginHost preload is missing from the build')
      if (chunk.imports.length > 0 || /^\s*(import|export)\b/m.test(chunk.code)) {
        throw new Error('the pluginHost preload must build to a plain script with no import or export')
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), sandboxedPreloadGuard()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // pluginHost imports nothing, so it never shares a chunk the sandbox couldn't load
        input: {
          index: resolve('src/preload/index.ts'),
          pluginHost: resolve('src/preload/pluginHost.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), signalingHostPolicy()]
  }
})
