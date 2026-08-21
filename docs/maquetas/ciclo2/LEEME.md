# Ciclo 2 · tres gramáticas de layout (ronda 1)

Bocetos vivos para decidir **la estructura** del flujo "Analizar mi negocio".
No tocan código de producción: viven solos, en HTML/CSS/JS plano.

Cómo verlos: `python3 -m http.server 4321 --directory docs/maquetas/ciclo2`
y abrir `http://localhost:4321/` (los tres, lado a lado, en marcos de teléfono).
Cada uno también abre solo: `/g1-escenas.html`, `/g2-rio.html`, `/g3-anillo.html`.

## El experimento

Las tres comparten **la misma piel** (`piel.css`) y **los mismos datos**
(`datos.js`). Lo único que cambia es el esqueleto. Es a propósito: el rechazo
del intento 3 fue "solo cambiaron los colores, la estructura sigue igual de
rígida", así que esta ronda mueve **una sola variable: la gramática de layout**.
El color, la tipografía y el movimiento se afinan al final, no ahora.

Ninguna de las tres es una columna de tarjetas apiladas. Ese esqueleto —el que
compartían los intentos 1, 2 y 3— está descartado de entrada.

| | Principio organizador | Dónde vive el dinero | Cómo llega el hallazgo | Dónde cae lo aprobado |
|---|---|---|---|---|
| **G1 · Escenas** | El tiempo de atención: una cosa por pantalla, se avanza, no hay scroll | Escena propia, a 78 px | Pantalla completa; la evidencia es una capa que la tapa | Juntado en la escena final |
| **G2 · Río** | La posición es el dato: todo está anclado a la hora que lo originó | Fijo arriba, siempre visible | Colgado con un hilo del tramo del cauce que lo produjo | Boya río abajo, en la hora en que sale |
| **G3 · Anillo** | Centro y periferia: el día entero cabe en una forma que nunca se pierde | Centro del aro | Muesca en el aro; el detalle sale como pétalo, con hilo al punto | Clavo en la cinta de mañana |

## Invariantes — verificadas en las tres

- Evidencia consultable: botón "¿De dónde lo saco?" con las citas del dato.
- Costo del envío visible **antes** de aprobar (mensajes de la bolsa del mes).
- Dónde se medirá, dicho en el mismo bloque.
- El resultado futuro es un hueco `$ ___` que llena el corte. **Cero estimaciones.**
- "Hoy no" pesa lo mismo que "Va" y no insiste: "no te lo vuelvo a sacar
  hasta que el dato cambie".
- Estado sano posible y visible: botón **estado sano** arriba a la derecha.
- Mexicano neutro, sin juicio a personas, sin ranking de barberos.
- `prefers-reduced-motion` apaga todo el movimiento (regla dura en `piel.css`).
- Todos los números son **inventados** y están marcados como tales en pantalla.

## Lo que esta ronda NO decide

Paleta final, tipografía, curvas de movimiento, y cómo se extiende a las 5
pestañas y a las vistas de staff. Todo eso viene después de clavar la gramática.

## Archivos

- `piel.css` — tokens, aurora, y las moléculas compartidas (evidencia, acción,
  costo/medición, hueco de resultado, tarea, "hoy no", estado sano).
- `datos.js` — los datos demo, iguales para las tres.
- `g1-escenas.html` · `g2-rio.html` · `g3-anillo.html` — las gramáticas.
- `index.html` — el comparativo y las preguntas por elemento.
