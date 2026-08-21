/* ═══════════════════════════════════════════════════════════════════════════
   DATOS DEMO — CICLO 2 · "Analizar mi negocio"
   ⚠️ TODO LO DE ESTE ARCHIVO ES INVENTADO. No sale de la BD. Existe para que
   las 3 gramáticas muestren EXACTAMENTE el mismo contenido y la única
   variable comparable sea la ESTRUCTURA.
   Cada hallazgo carga sus 3 invariantes: evidencia consultable, costo del
   envío, y dónde se medirá. El resultado futuro NUNCA se estima: es "$ ___".
   ═══════════════════════════════════════════════════════════════════════════ */
window.DEMO = {
  inventado: true,
  hoy: {
    fecha: 'Martes 20 de agosto',
    cobrado: 2960,
    agendado: 1740,
    hueco: 2300,
    ahora: '15:40',
    citasHechas: 7, citasPorVenir: 4, huecosHoy: 5,
  },
  // El día como tramos (lo usan el río y el anillo; la escena lo usa de resumen)
  tramos: [
    { h: '09', estado: 'hecho',  monto: 380 },
    { h: '10', estado: 'hecho',  monto: 560 },
    { h: '11', estado: 'hecho',  monto: 380 },
    { h: '12', estado: 'hueco',  monto: 0 },
    { h: '13', estado: 'hecho',  monto: 640 },
    { h: '14', estado: 'hecho',  monto: 380 },
    { h: '15', estado: 'hecho',  monto: 620 },
    { h: '16', estado: 'agenda', monto: 380 },
    { h: '17', estado: 'hueco',  monto: 0 },
    { h: '18', estado: 'hueco',  monto: 0 },
    { h: '19', estado: 'agenda', monto: 700 },
    { h: '20', estado: 'agenda', monto: 660 },
  ],
  lectura: [
    'Leí 312 citas de los últimos 30 días',
    'Comparé tu agenda contra las horas que abres',
    'Revisé quién dejó de venir y cuándo solía volver',
  ],
  hallazgos: [
    {
      id: 'h1',
      ancla: { tipo: 'franja', desde: 16, hasta: 19, etiqueta: '16–19 h' },
      titulo: 'Martes y miércoles de 4 a 7 se te vacían',
      bajada: 'No es todo el día: es esa franja, y se repite.',
      evidencia: {
        resumen: '18 de los 24 huecos del mes cayeron ahí',
        citas: [
          '24 huecos de 1 h en agosto (agenda vs. horario de apertura)',
          '18 de esos 24 fueron martes o miércoles, entre 16:00 y 19:00',
          'Las otras 6 se repartieron en 4 días distintos',
        ],
        forma: 'franjas',
      },
      accion: {
        verbo: 'Avisar a 9 clientes que suelen venir entre semana',
        mensaje: 'Hola {nombre}, soy Beto de Barbería Demo. Tengo lugar mañana miércoles entre 4 y 7. ¿Te aparto uno?',
        aQuien: '9 clientes que en los últimos 3 meses vinieron en martes o miércoles',
        costo: '9 de tus 150 mensajes del mes',
        medicion: 'En el corte del miércoles: las citas de 16 a 19 h',
        sale: 'mañana 10:00',
      },
    },
    {
      id: 'h2',
      ancla: { tipo: 'pasado', etiqueta: 'hace 40+ días' },
      titulo: '14 clientes no vuelven desde hace más de 40 días',
      bajada: 'Solían volver cada 26. Seis de ellos eran de los que más dejaban.',
      evidencia: {
        resumen: 'Su promedio de regreso era 26 días; van 41 a 68',
        citas: [
          '14 clientes con última visita entre el 3 de julio y el 11 de julio',
          'Promedio de regreso de tu clientela: 26 días',
          '6 de los 14 están arriba del ticket promedio del negocio',
        ],
        forma: 'puntos',
      },
      accion: {
        verbo: 'Mandar un mensaje de regreso a los 6 de mayor valor',
        mensaje: 'Hola {nombre}, hace rato que no te vemos por la barbería. Si quieres, te aparto lugar esta semana. ¿Qué día te queda?',
        aQuien: 'Los 6 de los 14 con más visitas acumuladas',
        costo: '6 de tus 150 mensajes del mes',
        medicion: 'En 14 días: cuántos de esos 6 agendaron',
        sale: 'mañana 10:00',
      },
    },
    {
      id: 'h3',
      ancla: { tipo: 'futuro', etiqueta: 'mañana' },
      titulo: '3 personas faltaron dos veces o más este mes',
      bajada: 'Dos de ellas ya tienen cita mañana.',
      evidencia: {
        resumen: '7 faltas en agosto; 5 son de esas 3 personas',
        citas: [
          '7 citas marcadas como no-show en agosto',
          '5 de las 7 vienen de 3 clientes',
          '2 de esos 3 tienen cita mañana (11:00 y 17:30)',
        ],
        forma: 'faltas',
      },
      accion: {
        verbo: 'Pedirles confirmación 3 horas antes',
        mensaje: 'Hola {nombre}, te confirmo tu cita de hoy a las {hora}. ¿Sigue en pie? Contéstame sí o no y lo dejo listo.',
        aQuien: 'Solo esas 2 citas de mañana',
        costo: '0 mensajes extra — usa el recordatorio que ya mandas',
        medicion: 'En el corte del mes: las faltas de agosto',
        sale: 'mañana 08:00',
      },
    },
  ],
};
