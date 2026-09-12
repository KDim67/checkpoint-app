import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'
import { SIGNALING_HOST } from './src/shared/signalingHost'

/**
 * index.html cannot import the signaling host, and its content security policy
 * has to name it. The policy carries a placeholder filled in from the constant,
 * and a policy that has lost the placeholder fails the build instead of quietly
 * blocking the relay.
 */
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
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
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
