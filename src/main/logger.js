'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

let logFile = null

function initLogger () {
  // Cria arquivo de log na pasta temp do usuário
  const logsDir = path.join(os.homedir(), '.coherence-logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
  logFile = path.join(logsDir, `app-${Date.now()}.log`)
  
  // Redireciona console.log, console.error, etc. para o arquivo
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn

  const writeLog = (level, args) => {
    const timestamp = new Date().toISOString()
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')
    const line = `[${timestamp}] [${level}] ${message}\n`
    
    try {
      fs.appendFileSync(logFile, line)
    } catch (err) {
      // fallback silencioso se falhar
    }
  }

  console.log = (...args) => {
    originalLog(...args)
    writeLog('LOG', args)
  }

  console.error = (...args) => {
    originalError(...args)
    writeLog('ERROR', args)
  }

  console.warn = (...args) => {
    originalWarn(...args)
    writeLog('WARN', args)
  }

  console.log(`[logger] logs salvos em: ${logFile}`)
}

module.exports = { initLogger }
