import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 127.0.0.1 (not localhost): Spotify only accepts loopback IPs as redirect URIs,
// and the session cookie must be set on the same host the page runs on.
// The proxy keeps API calls same-origin in dev, so the cookie is sent automatically.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
})
