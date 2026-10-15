import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import { AppRouter } from './App'
import { forwardWindowErrors } from './lib/windowErrors'
import './preflight.css'
import './index.css'

// before the first render, so an error while starting up is kept too
forwardWindowErrors()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
)
