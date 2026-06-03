import { render } from 'preact'
import { App } from './app'
import './globals.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — app works without SW
    })
  })
}

render(<App />, document.getElementById('app')!)
