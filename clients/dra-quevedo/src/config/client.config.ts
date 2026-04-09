import type { ClientConfig } from '@presenciapro/engine/types';

export const clientConfig = {

  profile: 'medical' as const,

  // ─── IDENTIDAD ───────────────────────────────────────────────────────────
  client: {
    id: 'dra-quevedo',
    name: 'Dra. Jaasiel Quevedo',
    specialty: 'Medicina Estética',
    domain: 'drajaasielquevedo.com',
    timezone: 'America/Mexico_City',
    locale: 'es-MX',
  },

  // ─── PERSONALIDAD DEL BOT ────────────────────────────────────────────────
  bot: {
    assistantName: 'Sofía',
    tone: 'warm-premium' as const,
    greeting: 'Hola, soy Sofía 👋 asistente de la Dra. Quevedo. ¿En qué te puedo ayudar?',
    awayMessage: 'En este momento estamos fuera de horario 🌙 Te respondo mañana a primera hora.',
    fallbackMessage: 'Déjame verificar eso con la Dra. Quevedo y te confirmo en breve 🌸',
    followUpDelayHours: 24,
    followUpMessage: 'Hola, ¿pudiste revisar la información? 😊 Quedamos a tus órdenes para agendar.',
    officeHours: {
      start: '09:00',
      end: '19:00',
      days: [1, 2, 3, 4, 5],
    },
  },

  // ─── ESPECIALISTAS ───────────────────────────────────────────────────────
  specialists: [
    {
      id: 'quevedo',
      name: 'Dra. Jaasiel Quevedo',
      area: 'Botox y medicina estética',
      tagline: 'Resultados naturales, atención personalizada — en tu casa o en consultorio',
      credentials: [
        'Cédula Profesional',
        'Aplicación certificada de toxina botulínica',
      ],
      yearsExperience: null,
      location: 'Zona Esmeralda, Estado de México',
      whatsapp: '5215558056215',
      calendarId: 'jaasiel@gmail.com',
      photo: '/images/doctor.jpg',
    },
  ],

  // ─── AGENDA ──────────────────────────────────────────────────────────────
  scheduling: {
    slotDurationMinutes: 45,
    bufferBetweenSlotsMinutes: 15,
    emergencySlotsPerDay: 1,
    advanceBookingDays: 30,
    reminderSchedule: [24, 2],
    cancellationWindowHours: 12,
    confirmationRequired: true,
    confirmationWindowHours: 2,
  },

  // ─── SERVICIOS ───────────────────────────────────────────────────────────
  services: [
    {
      id: 'botox-facial',
      name: 'Botox Facial',
      description: 'Suaviza líneas de expresión en frente, entrecejo y patas de gallo con resultados naturales.',
      durationMinutes: 45,
      icon: 'sparkles' as const,
      modes: ['domicilio', 'consultorio'] as const,
      specialistId: 'quevedo',
      postConsultaProducts: ['serum-vitamina-c', 'protector-solar-spf50'],
      followUpDays: 120,
    },
    {
      id: 'domicilio',
      name: 'Servicio a Domicilio',
      description: 'La misma calidad médica en la comodidad de tu casa. Disponible en CDMX y zona oriente del Estado de México.',
      durationMinutes: 45,
      icon: 'map-pin' as const,
      modes: ['domicilio'] as const,
      specialistId: 'quevedo',
      postConsultaProducts: [],
    },
    {
      id: 'consulta-inicial',
      name: 'Consulta Inicial',
      description: 'Atención en espacio privado y tranquilo en Zona Esmeralda. Sin salas de espera, sin prisa.',
      durationMinutes: 30,
      icon: 'home' as const,
      modes: ['consultorio'] as const,
      specialistId: 'quevedo',
      postConsultaProducts: [],
      followUpDays: 180,
    },
  ],

  // ─── MODALIDADES DE ATENCIÓN ─────────────────────────────────────────────
  serviceModes: {
    domicilio: {
      label: 'A domicilio',
      description: 'La Dra. va a tu casa. CDMX y Zona Esmeralda, EdoMex.',
      availableZones: ['CDMX', 'Zona Esmeralda', 'Interlomas', 'Huixquilucan'],
      additionalCost: 0,
    },
    consultorio: {
      label: 'En consultorio',
      description: 'Atención en consultorio boutique, Zona Esmeralda.',
      address: 'Zona Esmeralda, Estado de México',
      googleMapsUrl: '',
      parkingAvailable: true,
    },
  },

  // ─── INTAKE PRE-CONSULTA ─────────────────────────────────────────────────
  intake: {
    fields: [
      'nombre_completo',
      'fecha_nacimiento',
      'alergias_conocidas',
      'medicamentos_actuales',
      'motivo_consulta',
      'tratamientos_previos',
      'datos_facturacion',
    ],
    requiresSignature: true,
    signatureLabel: 'Acepto el aviso de privacidad y consentimiento informado',
    privacyUrl: '/privacidad',
  },

  // ─── CONTACTO ─────────────────────────────────────────────────────────────
  contact: {
    whatsapp: '5215558056215',
    whatsappMessage: 'Hola Sofía, me gustaría agendar una cita con la Dra. Quevedo',
    email: '',
    bookingUrl: '',
    instagram: '',
    tiktok: '',
    // Placeholder — el cliente confirmará la dirección definitiva antes del primer envío.
    reportEmail: 'jaasiel@gmail.com',
  },

  // ─── POST-CONSULTA ────────────────────────────────────────────────────────
  postConsulta: {
    reviewRequestDelayHours: 24,
    reviewUrl: '',
    reactivationDays: 60,
    reactivationMessage:
      'Hola, han pasado 2 meses desde tu última visita con la Dra. Quevedo 🌸 ¿Te gustaría agendar tu seguimiento?',
    // TODO(cliente): Personalizar con instrucciones post-tratamiento específicas.
    // Este mensaje se envía ~1h después de finalizada la cita.
    postConsultaMessage:
      'Hola, gracias por tu cita con la Dra. Quevedo 🌸 Recuerda evitar el sol directo y no tocarte la zona tratada durante las próximas 4 horas. Cualquier duda, aquí estamos.',
  },

  // ─── PRODUCTOS POST-CONSULTA ──────────────────────────────────────────────
  products: [
    {
      id: 'serum-vitamina-c',
      name: 'Sérum Vitamina C',
      description: 'Ideal para mantener el resultado de tu tratamiento.',
      price: 850,
      currency: 'MXN' as const,
      purchaseUrl: '',
    },
    {
      id: 'protector-solar-spf50',
      name: 'Protector Solar SPF 50',
      description: 'Protección esencial post-botox.',
      price: 420,
      currency: 'MXN' as const,
      purchaseUrl: '',
    },
  ],

  // ─── SEO ──────────────────────────────────────────────────────────────────
  seo: {
    title: 'Dra. Jaasiel Quevedo — Botox a domicilio | Zona Esmeralda, EdoMex',
    description:
      'Aplicación médica de botox con resultados naturales. Servicio a domicilio en CDMX y Estado de México, o en consultorio boutique en Zona Esmeralda.',
    keywords: [
      'botox a domicilio cdmx',
      'botox zona esmeralda',
      'botox estado de mexico',
      'medicina estetica a domicilio',
      'aplicacion botox domicilio',
    ],
    ogImage: '/images/og-image.jpg',
  },

  // ─── DISEÑO ───────────────────────────────────────────────────────────────
  design: {
    colors: {
      primary: '#8B6F5E',
      primaryLight: '#A68B7A',
      primaryDark: '#6B5248',
      background: '#FAFAF8',
      surface: '#F2F0ED',
      text: '#1A1A1A',
      textMuted: '#6B7280',
      border: '#E5E2DE',
      white: '#FFFFFF',
    },
    fonts: {
      heading: 'Playfair Display',
      body: 'Inter',
    },
    borderRadius: '0.5rem',
  },

} satisfies ClientConfig;
