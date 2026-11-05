// El horario informa a recepción; el estado de aprobación decide el acceso.
function windowStatus(cita, now = Date.now()) {
  if (cita.estado !== 'aprobada') return { valido: false, motivo: 'Cita sin aprobación vigente' }
  const difference = now - +new Date(cita.inicio)
  const minutes = Math.floor(Math.abs(difference) / 60000)
  if (minutes > 0) {
    const anticipada = difference < 0
    const avisoHorario = {
      tipo: anticipada ? 'anticipada' : 'tardia', minutos: minutes,
      mensaje: anticipada ? `Llegada anticipada: ${minutes} min antes de la hora de la cita. Puedes confirmar la entrada.` : `Llegada tardía: ${minutes} min después de la hora de la cita. Puedes confirmar la entrada.`,
    }
    return { valido: true, motivo: 'Verificar identidad y confirmar entrada', avisoHorario }
  }
  return { valido: true, motivo: 'Verificar identidad y confirmar entrada' }
}
module.exports = { windowStatus }
