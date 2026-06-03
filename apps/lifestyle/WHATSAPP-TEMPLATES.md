# WhatsApp Message Templates

Templates requeridos para envíos proactivos fuera de la ventana de 24h de conversación.
Meta rechaza texto libre con error 131026 cuando el cliente no ha respondido en las últimas 24h.

**Accion requerida antes del go-live:** crear y someter cada template en:
Meta Business Manager → WhatsApp Manager → Message Templates

Tiempo de aprobacion: 24-72h típicamente. Categoria UTILITY aprueba mas rapido que MARKETING.

---

## Puntos del codigo que requieren templates

| Punto | Archivo | Tipo de envio | Templates necesarios |
|---|---|---|---|
| Reminders de cita | `dispatch-lifestyle-notifications` | Proactivo (horas/dias despues) | reminder_24h, reminder_2h, reminder_1h |
| Follow-up post-cita | `dispatch-lifestyle-notifications` | Proactivo (dia siguiente) | follow_up |
| Solicitud de resena | `dispatch-lifestyle-notifications` | Proactivo (24h despues) | review_request |
| Slot en lista de espera | `dispatch-lifestyle-notifications` handleWaitlistExpiry | Proactivo | waitlist_slot_available |
| Slot en lista de espera | `notifyWaitlistOnCancel.ts` | Proactivo | waitlist_slot_available |
| Cancelacion desde panel | `assistant-actions.ts` cancelAppointment | Proactivo | cancellation_notice |
| Reagenda desde panel | `assistant-actions.ts` rescheduleAppointment | Proactivo | reschedule_notice |

**Nota sobre sendMessageFromPanel:** requiere `session_mode='human'` y generalmente ocurre dentro
de la ventana de 24h activa. No requiere template salvo que el operador tome control de una
conversacion inactiva hace >24h — edge case aceptable por ahora.

**Nota sobre notificacion al barbero en confirmed.ts:** se envia al `staff.whatsapp_id` justo
despues de que el cliente agenda. El staff suele tener conversacion activa con el numero del negocio.
Si se quiere garantia: agregar template `staff_new_appointment` como mejora futura.

---

## Templates

---

### 1. `appointment_reminder_24h`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `dispatch-lifestyle-notifications` (tipo `reminder_24h`)

**Body:**
```
Hola {{1}}, mañana tienes cita de {{2}} con {{3}} a las {{4}} en {{5}}. ¡Te esperamos!
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del servicio | Corte + Barba |
| {{3}} | Nombre del barbero | Carlos |
| {{4}} | Hora de la cita (formato legible) | 10:00 AM |
| {{5}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, mañana tienes cita de Corte + Barba con Carlos a las 10:00 AM en Barberia El Maestro. ¡Te esperamos!

**Nota de migracion:** El sistema actual guarda el `message_body` pre-construido en `confirmed.ts`
(linea ~197-207). Al migrar, ese campo puede quedar como fallback o eliminarse para usar siempre el template.

---

### 2. `appointment_reminder_2h`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `dispatch-lifestyle-notifications` (tipo `reminder_2h`)

**Body:**
```
Hola {{1}}, en 2 horas tienes cita de {{2}} con {{3}} a las {{4}} en {{5}}. ¡Te esperamos!
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del servicio | Corte + Barba |
| {{3}} | Nombre del barbero | Carlos |
| {{4}} | Hora de la cita | 10:00 AM |
| {{5}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, en 2 horas tienes cita de Corte + Barba con Carlos a las 10:00 AM en Barberia El Maestro. ¡Te esperamos!

---

### 3. `appointment_reminder_1h`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `dispatch-lifestyle-notifications` (tipo `reminder_1h`)

**Body:**
```
Hola {{1}}, te recordamos tu cita de {{2}} con {{3}} hoy a las {{4}} en {{5}}.
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del servicio | Corte + Barba |
| {{3}} | Nombre del barbero | Carlos |
| {{4}} | Hora de la cita | 10:00 AM |
| {{5}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, te recordamos tu cita de Corte + Barba con Carlos hoy a las 10:00 AM en Barberia El Maestro.

---

### 4. `appointment_follow_up`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `dispatch-lifestyle-notifications` (tipo `follow_up`)

**Body:**
```
Hola {{1}}, gracias por tu visita a {{2}}. Esperamos que hayas quedado satisfecho. ¿Como te fue?
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, gracias por tu visita a Barberia El Maestro. Esperamos que hayas quedado satisfecho. ¿Como te fue?

**Nota:** El dispatcher actualmente no genera este mensaje con variables del appointment — usa
`buildFallbackMessage()` con el nombre del negocio. Al migrar a template, el dispatcher debera
leer el nombre del cliente desde `customers` o guardarlo en `metadata` al crear la notificacion.

---

### 5. `appointment_review_request`

- **Categoria:** MARKETING
- **Idioma:** es_MX
- **Usado por:** `dispatch-lifestyle-notifications` (tipo `review_request`)

**Body:**
```
Hola {{1}}, gracias por visitarnos en {{2}}. ¿Nos regalas tu opinion? Puedes dejarnos una resena aqui: {{3}}
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del negocio | Barberia El Maestro |
| {{3}} | URL de resena (businesses.review_url) | https://maps.google.com/... |

**Ejemplo completo:**
> Hola Juan, gracias por visitarnos en Barberia El Maestro. ¿Nos regalas tu opinion? Puedes dejarnos una resena aqui: https://maps.google.com/...

**Nota:** El dispatcher ya lee `review_url` del JOIN con `businesses`. Al migrar, usar ese valor
como {{3}}. Si `review_url` es null, omitir este tipo de notificacion o usar fallback sin URL.

---

### 6. `waitlist_slot_available`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:**
  - `dispatch-lifestyle-notifications` `handleWaitlistExpiry` (cadena de expiracion)
  - `apps/lifestyle/src/lib/notifyWaitlistOnCancel.ts` (cancelacion desde panel)

**Body:**
```
Buenas noticias, {{1}}! Se libero un lugar para {{2}} el {{3}} a las {{4}} con {{5}}. ¿Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Nombre del servicio | Corte + Barba |
| {{3}} | Fecha del slot (en timezone del negocio) | Martes 3 de junio |
| {{4}} | Hora del slot (en timezone del negocio) | 11:00 AM |
| {{5}} | Nombre del barbero | Carlos |

**Ejemplo completo:**
> Buenas noticias, Juan! Se libero un lugar para Corte + Barba el Martes 3 de junio a las 11:00 AM con Carlos. ¿Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.

---

### 7. `appointment_cancellation_notice`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `apps/lifestyle/src/app/staff/assistant-actions.ts` `cancelAppointment` (linea ~148)

**Body:**
```
Hola {{1}}, tu cita del {{2}} a las {{3}} en {{4}} fue cancelada. Si deseas reagendar, responde a este mensaje.
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Fecha de la cita cancelada | lunes 2 de junio |
| {{3}} | Hora de la cita cancelada | 10:00 AM |
| {{4}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, tu cita del lunes 2 de junio a las 10:00 AM en Barberia El Maestro fue cancelada. Si deseas reagendar, responde a este mensaje.

---

### 8. `appointment_reschedule_notice`

- **Categoria:** UTILITY
- **Idioma:** es_MX
- **Usado por:** `apps/lifestyle/src/app/staff/assistant-actions.ts` `rescheduleAppointment` (linea ~511)

**Body:**
```
Hola {{1}}, tu cita del {{2}} a las {{3}} fue movida al {{4}} a las {{5}} en {{6}}. Si necesitas cambios, responde a este mensaje.
```

**Variables:**
| Variable | Descripcion | Ejemplo |
|---|---|---|
| {{1}} | Nombre del cliente | Juan |
| {{2}} | Fecha anterior | lunes 2 de junio |
| {{3}} | Hora anterior | 10:00 AM |
| {{4}} | Nueva fecha | miercoles 4 de junio |
| {{5}} | Nueva hora | 11:00 AM |
| {{6}} | Nombre del negocio | Barberia El Maestro |

**Ejemplo completo:**
> Hola Juan, tu cita del lunes 2 de junio a las 10:00 AM fue movida al miercoles 4 de junio a las 11:00 AM en Barberia El Maestro. Si necesitas cambios, responde a este mensaje.

---

## Checklist de sometimiento a Meta

Para cada template:

- [ ] Entrar a Meta Business Manager → WhatsApp Manager → Message Templates
- [ ] Crear nuevo template con el nombre exacto (snake_case) listado arriba
- [ ] Seleccionar idioma: Spanish (es_MX)
- [ ] Seleccionar categoria: UTILITY o MARKETING segun tabla
- [ ] Pegar el body exactamente como esta documentado (con {{1}}, {{2}}, etc.)
- [ ] Enviar para aprobacion
- [ ] Esperar 24-72h
- [ ] Confirmar estado "Approved" antes de activar en codigo

**Orden recomendado de sometimiento (por criticidad):**
1. `appointment_reminder_1h` — mas critico (reminders de corto plazo)
2. `appointment_cancellation_notice` — critico (operacion del panel)
3. `appointment_reschedule_notice` — critico (operacion del panel)
4. `waitlist_slot_available` — alto impacto
5. `appointment_reminder_2h`
6. `appointment_reminder_24h`
7. `appointment_follow_up`
8. `appointment_review_request` — MARKETING tarda mas

---

## Plan de migracion (despues de aprobacion)

1. Someter templates (esta semana, accion de Gabriel)
2. Esperar aprobacion Meta (24-72h)
3. Migrar `dispatch-lifestyle-notifications` para usar `sendTemplateMessage()` — ver `src/lib/whatsapp-templates.ts`
4. Migrar `notifyWaitlistOnCancel.ts`
5. Migrar `cancelAppointment` y `rescheduleAppointment` en `assistant-actions.ts`
6. Deploy de edge function actualizada
7. Verificar en prod con un envio real

El helper `apps/lifestyle/src/lib/whatsapp-templates.ts` ya contiene las funciones wrapper
y la logica de fallback a texto libre (para usar mientras los templates estan pendientes de aprobacion).
