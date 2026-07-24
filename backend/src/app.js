import express from 'express'

import cors from 'cors'

import { healthRouter } from './routes/health.js'

import { uploadsRouter } from './routes/uploads.js'

import { recordsRouter } from './routes/records.js'

import { settingsRouter } from './routes/settings.js'

import { kpiRouter } from './routes/kpi.js'
import { exportsRouter } from './routes/exports.js'



/**

 * @param {{ nodeEnv: string }} env

 */

export function createApp(env) {

  const app = express()



  app.use(cors())

  app.use((req, res, next) => {
    const end = res.json.bind(res)
    res.json = (body) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return end(body)
    }
    next()
  })

  app.use(express.json({ limit: '1mb' }))



  app.use('/api/v1', healthRouter)

  app.use('/api/v1/uploads', uploadsRouter)

  app.use('/api/v1/records', recordsRouter)

  app.use('/api/v1/settings', settingsRouter)

  app.use('/api/v1/kpi', kpiRouter)

  app.use('/api/v1/exports', exportsRouter)



  app.use((err, _req, res, _next) => {

    console.error('[api]', err.message)

    res.status(500).json({

      error: {

        code: 'INTERNAL_ERROR',

        message: err.message || 'Internal server error',

      },

    })

  })



  app.use((_req, res) => {

    res.status(404).json({

      error: {

        code: 'NOT_FOUND',

        message: 'Route not found',

      },

    })

  })



  return app

}


