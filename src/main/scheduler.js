'use strict'

/**
 * Polling adaptativo: consulta o DHT com mais frequência quando o app está em
 * primeiro plano/foco (resposta rápida a novidades), e reduz drasticamente em
 * segundo plano/minimizado (economiza rede/bateria). Isso é reconfigurado a
 * partir de eventos de foco/blur/minimize da janela do Electron.
 */
const INTERVALS = {
  focused: 20 * 1000,
  blurred: 60 * 1000,
  background: 5 * 60 * 1000
}

class PollScheduler {
  constructor (tickFn) {
    this.tickFn = tickFn
    this.state = 'focused'
    this._timer = null
  }

  start () {
    this._reschedule()
  }

  setState (state) {
    if (!INTERVALS[state] || state === this.state) return
    this.state = state
    this._reschedule()
  }

  _reschedule () {
    clearInterval(this._timer)
    const interval = INTERVALS[this.state]
    this._timer = setInterval(() => this.tickFn(), interval)
    // dispara um ciclo imediatamente ao mudar de estado, para reagir rápido a "voltou o foco"
    this.tickFn()
  }

  stop () {
    clearInterval(this._timer)
  }
}

module.exports = { PollScheduler, INTERVALS }
