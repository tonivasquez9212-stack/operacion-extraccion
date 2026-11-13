# 🎮 Operación Extracción — FPS 3D

**Curso:** Computación Gráfica y Visual · **Evaluación:** T3 · **Universidad Privada del Norte (UPN)**

Videojuego de disparos en primera persona desarrollado con **Three.js (WebGL)**.
La zona de cuarentena ha caído: atraviesa un complejo infestado de zombis, administra tu
munición y alcanza el helipuerto de extracción antes de ser atrapado.

> **Repositorio:** https://github.com/tonivasquez9212-stack/operacion-extraccion
> **Jugar en línea:** https://tonivasquez9212-stack.github.io/operacion-extraccion/
> **Video:** _(pega aquí el enlace)_

---

## ▶️ Cómo ejecutar

Requisito: [Node.js](https://nodejs.org) 18 o superior. No hay que instalar dependencias
(Three.js ya viene incluido en `vendor/`).

```bash
git clone https://github.com/tonivasquez9212-stack/operacion-extraccion.git
cd operacion-extraccion
npm start
```

Luego abre **http://localhost:8080** en Chrome, Edge o Firefox y pulsa **INICIAR MISIÓN**.

> El juego usa módulos ES y carga archivos `.glb`, por eso debe abrirse mediante un servidor
> local y no con doble clic sobre `index.html`. También sirve cualquier servidor estático,
> por ejemplo `npx serve` o `python -m http.server 8080`.

## 🕹️ Controles

| Control | Acción |
|---|---|
| `W` `A` `S` `D` | Avanzar / izquierda / retroceder / derecha |
| Mouse | Orientar la cámara (las flechas `←` `→` `↑` `↓` también giran) |
| Clic izquierdo | Disparar **una vez** (mantenerlo presionado no dispara en automático) |
| `1` | Seleccionar arma 1 — Pistola 9 mm |
| `2` | Seleccionar arma 2 — Rifle de cerrojo |
| `Esc` | Pausa (libera el mouse) |
| `Enter` | Reintentar tras la victoria o el Game Over |

## 📜 Reglas del juego

- Empiezas en el **búnker de inicio** con 10 balas de pistola y 4 de rifle.
- Cada zombi resiste **2 impactos**. Si uno te toca: **GAME OVER**.
- **No existe recarga.** La munición solo se recupera recogiendo **cajas de munición** (+6 pistola, +3 rifle).
- La **adrenalina** (inyector azul) aumenta tu velocidad ×1.6 durante 8 segundos.
- Los zombis rojos son **corredores**: te detectan desde más lejos y son casi tan rápidos como tú.
- El rifle atraviesa hasta 2 zombis alineados (1 impacto a cada uno), pero dispara lento.
- Llega al **helipuerto verde** (haz de luz visible desde lejos; la brújula del HUD apunta hacia él) para ganar.

Recorrido: búnker de inicio → almacén → patio de contenedores → laboratorios → pasillo → muelle → helipuerto.

## ✅ Requerimientos funcionales y dónde están en el código

Todo el juego está en [`src/main.js`](src/main.js), dividido en secciones numeradas.

| RF | Requisito | Implementación |
|---|---|---|
| RF01 | Dos armas GLB, teclas 1/2, un disparo por clic | `crearArmas()`, `seleccionarArma()`, evento `mousedown` → `disparar()` (sección 7 y 8) |
| RF02 | Contador por arma, bloqueo en cero, sin recarga libre | `arma.municion` en `disparar()`; solo `actualizarObjetos()` suma balas |
| RF03 | Mundo 3D explorable | Matriz `MAPA` (31×23 casillas de 3 m ≈ 93×69 m) + `construirMundo()` |
| RF04 | Zombis en GLB | `assets/models/zombi.glb` clonado en `crearZombi()`, con animaciones `Reposo` y `Caminar` |
| RF05 | Inactivo fuera de rango / persigue dentro | `actualizarZombis()`: `dist <= z.rango` → `activarZombi()`; persecución con campo de distancias BFS (`actualizarCampo()`) |
| RF06 | Cámara FPS, WASD + mouse, arma sigue a la cámara | `actualizarJugador()`; el arma es **hija de la cámara** (`camara.add(soporte)`) |
| RF07 | Impactos por raycasting, 2 de vida | `THREE.Raycaster` en `disparar()` + `herirZombi()` |
| RF08 | Inicio, desarrollo, extracción y victoria | `comprobarExtraccion()` → `terminar('victoria')` |
| RF09 | Game Over al contacto | `dist < distanciaAtaque` → `terminar('derrota')`; el bucle deja de actualizar el mundo |
| RF10 | Coleccionables | Caja de munición y adrenalina: `crearObjeto()` / `actualizarObjetos()` |
| RF11 | Dificultad | Objeto `CONFIG`: munición escasa, corredores, zonas con varios zombis, contenedores como obstáculos |
| RF12 | Repositorio e instrucciones | Este README |

### Detalles técnicos destacables (útiles para la sustentación)

- **Cámara FPS:** la orientación se guarda como `yaw` y `pitch`; la cámara usa orden de rotación `YXZ`.
  El movimiento se calcula con los vectores *adelante* `(-sen yaw, -cos yaw)` y *derecha* `(cos yaw, -sen yaw)`.
- **Arma en primera persona:** el modelo GLB es hijo de la cámara, por lo que hereda su matriz de transformación.
  Se dibuja en una segunda pasada (capa 1) tras limpiar el búfer de profundidad para que nunca atraviese los muros.
- **Disparo:** un rayo desde el centro de la pantalla (`setFromCamera((0,0))`) se intersecta con muros, suelo,
  contenedores y zombis vivos. Los impactos llegan ordenados por distancia: si lo primero es un muro, la bala se detiene.
- **Colisiones del jugador y de los zombis:** círculo contra la cuadrícula del mapa, resolviendo cada eje por separado para deslizar por las paredes.
- **IA de los zombis:** máquina de dos estados (inactivo → activo). Si hay línea recta libre van directo al jugador;
  si no, siguen un campo de distancias calculado por BFS desde la casilla del jugador para rodear muros y cruzar puertas.
- **Modelos GLB:** generados por [`tools/generar_modelos.mjs`](tools/generar_modelos.mjs), que escribe el binario glTF 2.0
  (cabecera, bloque JSON y bloque BIN con posiciones, normales, índices, materiales PBR, jerarquía de nodos y animaciones).

## 📁 Estructura

```
operacion-extraccion/
├── index.html              Página, HUD y pantallas
├── servidor.mjs            Servidor estático local (npm start)
├── src/
│   ├── main.js             Toda la lógica del juego
│   └── estilos.css         Estilos del HUD y los menús
├── assets/models/          pistola.glb · rifle.glb · zombi.glb · caja_municion.glb · adrenalina.glb
├── tools/generar_modelos.mjs   Generador de los modelos GLB (npm run modelos)
└── vendor/three/           Three.js r160 (licencia MIT)
```

## 🌐 Despliegue opcional (GitHub Pages)

Al ser un sitio estático, basta con activar **Settings → Pages → Deploy from a branch → `main` / root**.

## 📚 Recursos externos y licencias

| Recurso | Fuente | Licencia |
|---|---|---|
| Three.js r160 (`vendor/three/`) | https://threejs.org · https://github.com/mrdoob/three.js | MIT |
| Modelos 3D (.glb) | Creación propia, generados con `tools/generar_modelos.mjs` | Propia |
| Texturas | Creación propia, generadas por código con Canvas 2D | Propia |
| Sonidos | Creación propia, sintetizados con Web Audio API | Propia |
