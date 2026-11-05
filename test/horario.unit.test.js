const { test } = require('node:test')
const assert = require('node:assert/strict')
const { windowStatus } = require('../src/modules/citas/cita.horario')
const cita = { estado: 'aprobada', inicio: new Date('2026-11-05T15:00:00Z'), fin: new Date('2026-11-05T16:00:00Z') }
test('antes y después del horario permite validar y avisa la diferencia desde el inicio', () => {
  for (const [now, tipo, minutos] of [['2026-11-05T13:00:00Z', 'anticipada', 120], ['2026-11-05T15:15:00Z', 'tardia', 15], ['2026-11-06T15:00:00Z', 'tardia', 1440]]) {
    const status = windowStatus(cita, +new Date(now))
    assert.equal(status.valido, true); assert.equal(status.avisoHorario.tipo, tipo); assert.equal(status.avisoHorario.minutos, minutos)
  }
})
test('en la hora programada no avisa; nunca admite citas sin aprobación o ya usadas', () => {
  assert.equal(windowStatus(cita, +cita.inicio).avisoHorario, undefined)
  for (const estado of ['pendiente', 'cancelada', 'ingresada', 'finalizada', 'no_asistio']) assert.equal(windowStatus({ ...cita, estado }, +cita.inicio).valido, false)
})
