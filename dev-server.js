// Runs the /api functions on your own computer for `npm run dev`.
// On Vercel this file isn't used.
import 'dotenv/config'
import express from 'express'
import handler from './api/[resource].js'

const app = express()
app.use('/api/local-file', express.raw({ type: () => true, limit: '500mb' }))
app.use(express.json({ limit: '2mb' }))
app.all('/api/:resource', (req, res) => {
  const proxied = Object.create(req)
  Object.defineProperty(proxied, 'query', { value: { ...req.query, resource: req.params.resource }, enumerable: true })
  return handler(proxied, res)
})
app.listen(3002, () => console.log('API → http://localhost:3002'))
