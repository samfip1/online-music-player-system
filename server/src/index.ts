import { createServer } from 'node:http'
import { app } from './app.js'
import { env } from './config.js'
import { attachRealtime } from './realtime.js'

const server = createServer(app)
attachRealtime(server)

server.listen(env.PORT, '127.0.0.1', () => {
  console.log(`Server on http://127.0.0.1:${env.PORT}`)
})
