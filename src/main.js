// ============================================================================
//  OPERACIÓN EXTRACCIÓN — FPS 3D de supervivencia zombi (Three.js / WebGL)
//  T3 · Computación Gráfica y Visual · UPN
//
//  Índice del archivo (cada bloque corresponde a un requerimiento funcional):
//    1. CONFIG ............ parámetros ajustables del juego
//    2. MAPA .............. diseño del nivel en una cuadrícula (RF03 / RF08)
//    3. Escena y luces
//    4. Audio sintetizado
//    5. Construcción del mundo (RF03)
//    6. Jugador y cámara FPS (RF06)
//    7. Armas y munición (RF01 / RF02)
//    8. Disparo con raycasting (RF07)
//    9. Zombis: detección y persecución (RF04 / RF05)
//   10. Coleccionables (RF10)
//   11. Victoria / Game Over (RF08 / RF09)
//   12. HUD y bucle principal
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ----------------------------------------------------------------------------
// 1. CONFIG — todos los valores de dificultad se ajustan aquí (RF11)
// ----------------------------------------------------------------------------
const CONFIG = {
  celda: 3,            // tamaño en metros de cada casilla del mapa
  alturaMuro: 3.6,
  jugador: { altura: 1.65, radio: 0.42, velocidad: 5.2, sensibilidad: 0.0022 },
  armas: [
    { // Arma 1 (tecla 1): rápida, alcance medio
      id: 'pistola', nombre: 'Pistola 9 mm', modelo: 'pistola.glb',
      municionInicial: 10, cadencia: 0.25, alcance: 35, penetracion: 1,
      vista: { pos: [0.19, -0.2, -0.42], escala: 1.0 }, boca: [0, 0.062, -0.2],
    },
    { // Arma 2 (tecla 2): lenta, largo alcance, atraviesa hasta 2 zombis
      id: 'rifle', nombre: 'Rifle de cerrojo', modelo: 'rifle.glb',
      municionInicial: 4, cadencia: 0.95, alcance: 90, penetracion: 2,
      vista: { pos: [0.16, -0.15, -0.2], escala: 0.5 }, boca: [0, 0.05, -0.79],
    },
  ],
  zombi: { vida: 2, rangoDeteccion: 14, velocidad: 2.3, radio: 0.4, distanciaAtaque: 0.95 },
  corredor: { rangoDeteccion: 18, velocidad: 4.0 },   // variante rápida ('R' en el mapa)
  cajaMunicion: { pistola: 6, rifle: 3 },             // balas que entrega cada caja
  adrenalina: { duracion: 8, multiplicador: 1.6 },
  radioRecogida: 1.4,
};

// ----------------------------------------------------------------------------
// 2. MAPA — '#' muro · '.' suelo · 'C' contenedor (obstáculo bajo) · 'S' inicio
//    'E' extracción · 'Z' zombi · 'R' zombi corredor · 'A' munición · 'V' adrenalina
//    Recorrido: búnker de inicio → almacén → patio → laboratorios → muelle → helipuerto
// ----------------------------------------------------------------------------
const MAPA = [
  '###############################',
  '#...#.........#...............#',
  '#.S.#..Z...C..#..C....Z.....A.#',
  '#...#.........#.......C.......#',
  '#...#..C...Z..#..Z............#',
  '#.......A.....#.......R...C...#',
  '#...#.........#...............#',
  '#...#.....C.......C...........#',
  '#####.........#...............#',
  '###########################.###',
  '#.............#.......#.......#',
  '#..Z...C......#..Z....#...Z...#',
  '#.........Z...#.......#.......#',
  '#..C..............C.......C...#',
  '#......R..A...#....Z..#.......#',
  '#.............#.......#...V...#',
  '#.#############################',
  '#.#...........#...............#',
  '#.#..Z....C...#..R.......EEE..#',
  '#.....C.......#......C...EEE..#',
  '#.#......Z.R......Z......EEE..#',
  '#.#..A........#...............#',
  '###############################',
];
const COLS = MAPA[0].length, FILAS = MAPA.length, C = CONFIG.celda;
MAPA.forEach((f, i) => { if (f.length !== COLS) throw new Error(`Fila ${i} del mapa mide ${f.length}, se esperaba ${COLS}`); });

const celdaEn = (c, f) => (f < 0 || f >= FILAS || c < 0 || c >= COLS ? '#' : MAPA[f][c]);
const esSolida = (c, f) => { const k = celdaEn(c, f); return k === '#' || k === 'C'; };
const centroDe = (c, f) => new THREE.Vector3((c + 0.5) * C, 0, (f + 0.5) * C);
const aCelda = (v) => Math.floor(v / C);

/** ¿Un cuerpo de radio r centrado en (x,z) toca alguna casilla sólida? */
function hayColision(x, z, r) {
  const c0 = aCelda(x - r), c1 = aCelda(x + r), f0 = aCelda(z - r), f1 = aCelda(z + r);
  for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) if (esSolida(c, f)) return true;
  return false;
}
/** Movimiento con deslizamiento: se prueba cada eje por separado. */
function moverConColision(pos, dx, dz, r) {
  if (!hayColision(pos.x + dx, pos.z, r)) pos.x += dx;
  if (!hayColision(pos.x, pos.z + dz, r)) pos.z += dz;
}

// ----------------------------------------------------------------------------
// 3. Escena, cámara, renderizador y luces
// ----------------------------------------------------------------------------
const lienzo = document.getElementById('lienzo');
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false; // se dibuja en dos pasadas: mundo y luego arma (ver bucle)

const COLOR_NIEBLA = 0x1c2a30;
const escena = new THREE.Scene();
renderer.setClearColor(COLOR_NIEBLA); // (no se usa escena.background: forzaría un borrado en la 2.ª pasada)
escena.fog = new THREE.FogExp2(COLOR_NIEBLA, 0.024);

const camara = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 220);
camara.rotation.order = 'YXZ'; // primero guiñada (yaw) y luego cabeceo (pitch)
escena.add(camara);            // la cámara está en la escena para poder colgarle el arma

const CAPA_ARMA = 1; // el arma vive en otra capa para no atravesar los muros

escena.add(new THREE.HemisphereLight(0x9fc4d8, 0x2a2a22, 1.15));
const luna = new THREE.DirectionalLight(0xbfd6ff, 1.1);
luna.position.set(30, 60, 20);
escena.add(luna);
// Linterna del jugador: acompaña a la cámara
const linterna = new THREE.SpotLight(0xfff1d0, 12, 40, 0.5, 0.55, 0.5);
linterna.position.set(0.1, -0.1, 0);
linterna.target.position.set(0, -0.05, -1);
camara.add(linterna, linterna.target);
// Destello del disparo
const luzDisparo = new THREE.PointLight(0xffc266, 0, 14, 1.8);
luzDisparo.position.set(0.2, -0.1, -0.8);
camara.add(luzDisparo);

addEventListener('resize', () => {
  camara.aspect = innerWidth / innerHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ----------------------------------------------------------------------------
// 4. Audio sintetizado con Web Audio (no se usan archivos externos)
// ----------------------------------------------------------------------------
let audio = null;
function iniciarAudio() {
  try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
}
function sonidoRuido(dur, frecFiltro, vol) {
  if (!audio) return;
  const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = audio.createBufferSource(), fil = audio.createBiquadFilter(), gan = audio.createGain();
  src.buffer = buf; fil.type = 'lowpass'; fil.frequency.value = frecFiltro; gan.gain.value = vol;
  src.connect(fil).connect(gan).connect(audio.destination); src.start();
}
function sonidoTono(f0, f1, dur, tipo = 'sine', vol = 0.15) {
  if (!audio) return;
  const t = audio.currentTime, osc = audio.createOscillator(), gan = audio.createGain();
  osc.type = tipo; osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  gan.gain.setValueAtTime(vol, t); gan.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gan).connect(audio.destination); osc.start(t); osc.stop(t + dur);
}
const SONIDO = {
  pistola: () => { sonidoRuido(0.18, 2600, 0.5); sonidoTono(220, 60, 0.12, 'square', 0.12); },
  rifle: () => { sonidoRuido(0.45, 1300, 0.8); sonidoTono(140, 35, 0.3, 'sawtooth', 0.18); },
  vacio: () => sonidoTono(900, 700, 0.05, 'square', 0.08),
  cambio: () => sonidoTono(500, 300, 0.06, 'triangle', 0.08),
  recoger: () => { sonidoTono(660, 660, 0.09, 'triangle', 0.14); setTimeout(() => sonidoTono(990, 990, 0.14, 'triangle', 0.14), 90); },
  grunido: () => sonidoTono(110 + Math.random() * 40, 55, 0.7, 'sawtooth', 0.09),
  impacto: () => sonidoRuido(0.1, 700, 0.35),
  victoria: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => sonidoTono(f, f, 0.3, 'triangle', 0.16), i * 140)),
  derrota: () => { sonidoTono(200, 40, 1.2, 'sawtooth', 0.22); sonidoRuido(0.8, 500, 0.5); },
};

// ----------------------------------------------------------------------------
// 5. Construcción del mundo (RF03) — geometría programada + texturas en canvas
// ----------------------------------------------------------------------------
function texturaCanvas(tam, pintar) {
  const cv = document.createElement('canvas'); cv.width = cv.height = tam;
  const g = cv.getContext('2d'); pintar(g, tam);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function granular(g, tam, n, alfa) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255 | 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alfa})`;
    g.fillRect(Math.random() * tam, Math.random() * tam, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}
const texSuelo = texturaCanvas(256, (g, t) => {
  g.fillStyle = '#4b4f4c'; g.fillRect(0, 0, t, t); granular(g, t, 5000, 0.09);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3; g.strokeRect(0, 0, t, t);
  g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(t / 2, 0); g.lineTo(t / 2, t); g.moveTo(0, t / 2); g.lineTo(t, t / 2); g.stroke();
});
const texMuro = texturaCanvas(256, (g, t) => {
  g.fillStyle = '#7b8078'; g.fillRect(0, 0, t, t); granular(g, t, 6000, 0.1);
  for (let i = 0; i < 6; i++) { // manchas de humedad
    const x = Math.random() * t, grad = g.createLinearGradient(0, 0, 0, t);
    grad.addColorStop(0, 'rgba(30,35,25,.35)'); grad.addColorStop(1, 'rgba(30,35,25,0)');
    g.fillStyle = grad; g.fillRect(x, 0, 6 + Math.random() * 18, t * (0.4 + Math.random() * 0.6));
  }
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3;
  [0.33, 0.66].forEach((y) => { g.beginPath(); g.moveTo(0, t * y); g.lineTo(t, t * y); g.stroke(); });
  g.strokeRect(0, 0, t, t);
  for (let x = -t; x < t; x += 32) { // franja de peligro en la base
    g.fillStyle = '#c9a21a'; g.beginPath();
    g.moveTo(x, t); g.lineTo(x + 16, t); g.lineTo(x + 36, t - 20); g.lineTo(x + 20, t - 20); g.fill();
  }
});
const texContenedor = texturaCanvas(256, (g, t) => {
  g.fillStyle = '#7a4a22'; g.fillRect(0, 0, t, t); granular(g, t, 4000, 0.12);
  g.strokeStyle = '#3d2410'; g.lineWidth = 14; g.strokeRect(7, 7, t - 14, t - 14);
  g.lineWidth = 10; g.beginPath(); g.moveTo(10, 10); g.lineTo(t - 10, t - 10); g.moveTo(t - 10, 10); g.lineTo(10, t - 10); g.stroke();
});
function texturaRotulo(texto, colorFondo, colorTexto, simbolo) {
  return texturaCanvas(512, (g, t) => {
    g.fillStyle = colorFondo; g.fillRect(0, 0, t, t);
    g.strokeStyle = colorTexto; g.lineWidth = 16; g.strokeRect(20, 20, t - 40, t - 40);
    g.fillStyle = colorTexto; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 250px Consolas, monospace'; g.fillText(simbolo, t / 2, t / 2 - 30);
    g.font = 'bold 54px Consolas, monospace'; g.fillText(texto, t / 2, t - 90);
  });
}

const obstaculos = [];   // mallas que detienen las balas
const zonaExtraccion = { centro: new THREE.Vector3(), haz: null };
const inicioJugador = new THREE.Vector3();

function construirMundo() {
  // Suelo
  const ts = texSuelo.clone(); ts.repeat.set(COLS, FILAS); ts.needsUpdate = true;
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(COLS * C, FILAS * C), new THREE.MeshStandardMaterial({ map: ts, roughness: 0.95 }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.set(COLS * C / 2, 0, FILAS * C / 2);
  escena.add(suelo); obstaculos.push(suelo);

  // Muros y contenedores con InstancedMesh (una sola llamada de dibujo por tipo)
  const celdas = { '#': [], C: [], E: [] };
  for (let f = 0; f < FILAS; f++) for (let c = 0; c < COLS; c++) {
    const k = MAPA[f][c];
    if (celdas[k]) celdas[k].push([c, f]);
    if (k === 'S') inicioJugador.copy(centroDe(c, f));
  }
  const m4 = new THREE.Matrix4();
  const H = CONFIG.alturaMuro;
  const muros = new THREE.InstancedMesh(new THREE.BoxGeometry(C, H, C), new THREE.MeshStandardMaterial({ map: texMuro, roughness: 0.9 }), celdas['#'].length);
  celdas['#'].forEach(([c, f], i) => { const p = centroDe(c, f); muros.setMatrixAt(i, m4.makeTranslation(p.x, H / 2, p.z)); });
  const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(C - 0.1, 1.25, C - 0.1), new THREE.MeshStandardMaterial({ map: texContenedor, roughness: 0.85 }), celdas.C.length);
  celdas.C.forEach(([c, f], i) => { const p = centroDe(c, f); cont.setMatrixAt(i, m4.makeTranslation(p.x, 0.625, p.z)); });
  escena.add(muros, cont); obstaculos.push(muros, cont);

  // Zona de inicio claramente identificada
  const rotInicio = new THREE.Mesh(new THREE.PlaneGeometry(C * 1.6, C * 1.6),
    new THREE.MeshBasicMaterial({ map: texturaRotulo('ZONA DE INICIO', '#0e2a44', '#59b8ff', '▼'), transparent: true, opacity: 0.9 }));
  rotInicio.rotation.x = -Math.PI / 2; rotInicio.position.copy(inicioJugador).setY(0.02);
  escena.add(rotInicio);

  // Zona de extracción: helipuerto verde con haz de luz visible a distancia
  const xs = celdas.E.map(([c]) => c), fs = celdas.E.map(([, f]) => f);
  const cMin = Math.min(...xs), cMax = Math.max(...xs), fMin = Math.min(...fs), fMax = Math.max(...fs);
  const ancho = (cMax - cMin + 1) * C, largo = (fMax - fMin + 1) * C;
  zonaExtraccion.centro.set((cMin + cMax + 1) * C / 2, 0, (fMin + fMax + 1) * C / 2);
  const helipuerto = new THREE.Mesh(new THREE.PlaneGeometry(ancho, largo),
    new THREE.MeshBasicMaterial({ map: texturaRotulo('EXTRACCIÓN', '#0d3b1c', '#7dff8a', 'H') }));
  helipuerto.rotation.x = -Math.PI / 2; helipuerto.position.copy(zonaExtraccion.centro).setY(0.03);
  const haz = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 60, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  haz.position.copy(zonaExtraccion.centro).setY(30);
  const luzZona = new THREE.PointLight(0x5dff7a, 60, 26, 1.6);
  luzZona.position.copy(zonaExtraccion.centro).setY(3);
  zonaExtraccion.haz = haz;
  escena.add(helipuerto, haz, luzZona);
}

// ----------------------------------------------------------------------------
// 6. Jugador y cámara en primera persona (RF06)
// ----------------------------------------------------------------------------
const jugador = { pos: new THREE.Vector3(), yaw: Math.PI, pitch: 0, impulso: 0, paso: 0, moviendose: false };
const teclas = new Set();
let estado = 'cargando'; // cargando | inicio | jugando | pausa | victoria | derrota
const estadisticas = { disparos: 0, impactos: 0, bajas: 0, tiempo: 0 };

addEventListener('keydown', (e) => {
  teclas.add(e.code);
  if (e.code === 'Digit1' || e.code === 'Numpad1') seleccionarArma(0);
  if (e.code === 'Digit2' || e.code === 'Numpad2') seleccionarArma(1);
  if (e.code === 'Enter' && (estado === 'victoria' || estado === 'derrota')) location.reload();
});
addEventListener('keyup', (e) => teclas.delete(e.code));
addEventListener('blur', () => teclas.clear());

// El mouse orienta la cámara (solo con el puntero capturado)
// Lo normal es capturar el puntero (Pointer Lock). Si el navegador no lo permite
// (p. ej. dentro de un iframe o un panel de vista previa) se activa el "modo libre":
// el mouse orienta la cámara sin captura y los bordes de la pantalla siguen girando.
let modoLibre = false;
let cursorX = 0.5; // posición horizontal del cursor (0..1), usada en modo libre
addEventListener('mousemove', (e) => {
  if (estado !== 'jugando') return;
  const capturado = document.pointerLockElement === lienzo;
  if (!capturado && !modoLibre) return;
  cursorX = e.clientX / innerWidth;
  jugador.yaw -= e.movementX * CONFIG.jugador.sensibilidad;
  jugador.pitch -= e.movementY * CONFIG.jugador.sensibilidad;
  jugador.pitch = THREE.MathUtils.clamp(jugador.pitch, -1.45, 1.45);
});
document.addEventListener('mouseleave', () => { cursorX = 0.5; });

/** Giro con las flechas del teclado (siempre) y con los bordes de la pantalla (modo libre). */
function girarConTeclado(dt) {
  let giro = 0, cabeceo = 0;
  if (teclas.has('ArrowLeft')) giro += 1;
  if (teclas.has('ArrowRight')) giro -= 1;
  if (teclas.has('ArrowUp')) cabeceo += 1;
  if (teclas.has('ArrowDown')) cabeceo -= 1;
  if (modoLibre && document.pointerLockElement !== lienzo) {
    if (cursorX < 0.1) giro += (0.1 - cursorX) * 10;
    if (cursorX > 0.9) giro -= (cursorX - 0.9) * 10;
  }
  jugador.yaw += giro * 2.4 * dt;
  jugador.pitch = THREE.MathUtils.clamp(jugador.pitch + cabeceo * 1.6 * dt, -1.45, 1.45);
}

function actualizarJugador(dt) {
  girarConTeclado(dt);
  // Vectores "adelante" y "derecha" en el plano XZ según la guiñada de la cámara
  const sen = Math.sin(jugador.yaw), cos = Math.cos(jugador.yaw);
  let ax = 0, az = 0; // intención de movimiento: az = adelante/atrás, ax = lateral
  if (teclas.has('KeyW')) az += 1;
  if (teclas.has('KeyS')) az -= 1;
  if (teclas.has('KeyD')) ax += 1;
  if (teclas.has('KeyA')) ax -= 1;
  const largo = Math.hypot(ax, az);
  jugador.moviendose = largo > 0;
  if (largo > 0) {
    ax /= largo; az /= largo; // normalizar para que la diagonal no sea más rápida
    let vel = CONFIG.jugador.velocidad;
    if (jugador.impulso > 0) vel *= CONFIG.adrenalina.multiplicador;
    const dx = (-sen * az + cos * ax) * vel * dt;
    const dz = (-cos * az - sen * ax) * vel * dt;
    moverConColision(jugador.pos, dx, dz, CONFIG.jugador.radio);
    jugador.paso += dt * vel * 1.9;
  }
  if (jugador.impulso > 0) jugador.impulso = Math.max(0, jugador.impulso - dt);

  const balanceo = jugador.moviendose ? Math.sin(jugador.paso) * 0.035 : 0;
  camara.position.set(jugador.pos.x, CONFIG.jugador.altura + balanceo, jugador.pos.z);
  camara.rotation.set(jugador.pitch, jugador.yaw, 0);
}

// ----------------------------------------------------------------------------
// 7. Armas y munición (RF01 / RF02)
// ----------------------------------------------------------------------------
const armas = [];        // { cfg, municion, soporte, fogonazo }
let armaActual = 0, armaVisible = 0;
let enfriamiento = 0;    // tiempo restante hasta poder volver a disparar
let retroceso = 0;       // animación de retroceso (0..1)
let cambio = 1;          // animación de cambio de arma (0 = inicia, 1 = terminada)

const texFogonazo = texturaCanvas(64, (g, t) => {
  const grad = g.createRadialGradient(t / 2, t / 2, 0, t / 2, t / 2, t / 2);
  grad.addColorStop(0, 'rgba(255,255,230,1)'); grad.addColorStop(0.35, 'rgba(255,190,70,.85)'); grad.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, t, t);
});

function crearArmas(modelos) {
  CONFIG.armas.forEach((cfg, i) => {
    // El modelo GLB se cuelga de la CÁMARA: así hereda su posición y rotación
    // y siempre queda en la misma posición relativa a la vista del jugador.
    const soporte = new THREE.Group();
    const modelo = modelos[cfg.id].scene;
    soporte.add(modelo);
    soporte.scale.setScalar(cfg.vista.escala);
    const fogonazo = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: texFogonazo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fogonazo.position.fromArray(cfg.boca); fogonazo.scale.setScalar(1 / cfg.vista.escala); fogonazo.visible = false;
    soporte.add(fogonazo);
    soporte.traverse((o) => o.layers.set(CAPA_ARMA));
    soporte.visible = i === 0;
    camara.add(soporte);
    armas.push({ cfg, municion: cfg.municionInicial, soporte, fogonazo });
  });
}

function seleccionarArma(i) {
  if (estado !== 'jugando' || i === armaActual || !armas[i]) return;
  armaActual = i; cambio = 0; // la animación oculta el arma anterior y sube la nueva
  SONIDO.cambio();
}

function actualizarArmaVista(dt) {
  if (!armas.length) return;
  if (cambio < 1) {
    cambio = Math.min(1, cambio + dt / 0.3);
    if (cambio >= 0.5 && armaVisible !== armaActual) {
      armas[armaVisible].soporte.visible = false;
      armaVisible = armaActual;
      armas[armaVisible].soporte.visible = true;
    }
  }
  retroceso = Math.max(0, retroceso - dt * 6);
  enfriamiento = Math.max(0, enfriamiento - dt);
  const a = armas[armaVisible], [x, y, z] = a.cfg.vista.pos;
  const bajada = Math.sin(cambio * Math.PI);                 // 0 → 1 → 0
  const bx = jugador.moviendose && estado === 'jugando' ? Math.cos(jugador.paso * 0.5) * 0.008 : 0;
  const by = jugador.moviendose && estado === 'jugando' ? Math.abs(Math.sin(jugador.paso * 0.5)) * 0.008 : 0;
  a.soporte.position.set(x + bx, y - bajada * 0.3 - by, z + retroceso * 0.07);
  a.soporte.rotation.set(retroceso * 0.28 - bajada * 0.6, 0.04, 0);
}

// ----------------------------------------------------------------------------
// 8. Disparo con raycasting y colisiones (RF07)
// ----------------------------------------------------------------------------
const rayo = new THREE.Raycaster();
const efectos = []; // objetos temporales: trazadoras, chispas, fogonazos

function efecto(obj, vida, alTerminar) { efectos.push({ obj, vida, total: vida, alTerminar }); return obj; }
function actualizarEfectos(dt) {
  for (let i = efectos.length - 1; i >= 0; i--) {
    const e = efectos[i]; e.vida -= dt;
    if (e.obj.material?.transparent) e.obj.material.opacity = Math.max(0, e.vida / e.total);
    if (e.vida <= 0) { e.alTerminar ? e.alTerminar() : (e.obj.removeFromParent(), e.obj.geometry?.dispose(), e.obj.material?.dispose()); efectos.splice(i, 1); }
  }
}
const geoChispa = new THREE.SphereGeometry(0.07, 6, 6);

// Un clic = un disparo. Se usa 'mousedown', que el navegador emite UNA sola vez
// por pulsación: mantener el botón presionado no genera más disparos.
addEventListener('mousedown', (e) => { if (e.button === 0 && estado === 'jugando') disparar(); });

function disparar() {
  const arma = armas[armaActual];
  if (estado !== 'jugando' || cambio < 1 || enfriamiento > 0) return false;
  if (arma.municion <= 0) {            // RF02: sin munición no se puede disparar
    SONIDO.vacio(); aviso('SIN MUNICIÓN — busca una caja', 'alerta'); enfriamiento = 0.2;
    return false;
  }
  arma.municion -= 1;                  // RF02: cada disparo consume una bala
  enfriamiento = arma.cfg.cadencia; retroceso = 1; estadisticas.disparos++;
  SONIDO[arma.cfg.id]();

  // Rayo desde el centro de la pantalla en la dirección de la cámara
  escena.updateMatrixWorld(); // posiciones al día de cámara y zombis antes de lanzar el rayo
  rayo.setFromCamera(new THREE.Vector2(0, 0), camara);
  rayo.far = arma.cfg.alcance;
  const blancos = [...obstaculos, ...zombis.filter((z) => z.vivo).map((z) => z.raiz)];
  const choques = rayo.intersectObjects(blancos, true); // ordenados del más cercano al más lejano

  let puntoFinal = rayo.ray.at(arma.cfg.alcance, new THREE.Vector3());
  const yaHeridos = new Set();
  for (const ch of choques) {
    const z = ch.object.userData.zombi;
    if (!z) { puntoFinal = ch.point; chispa(ch.point, 0xffd27a); break; }  // muro, contenedor o suelo: la bala se detiene
    if (yaHeridos.has(z)) continue;      // varias piezas del mismo zombi cuentan como un solo impacto
    yaHeridos.add(z);
    herirZombi(z, rayo.ray.direction);
    chispa(ch.point, 0xb01515);
    puntoFinal = ch.point;
    if (yaHeridos.size >= arma.cfg.penetracion) break;
  }
  if (yaHeridos.size) {
    estadisticas.impactos += yaHeridos.size; SONIDO.impacto();
    const mira = document.getElementById('mira'); mira.classList.add('impacto'); setTimeout(() => mira.classList.remove('impacto'), 140);
  }

  // Efectos visuales: fogonazo, luz y trazadora desde la boca del arma
  arma.fogonazo.visible = true; arma.fogonazo.material.opacity = 1; arma.fogonazo.rotation.z = Math.random() * Math.PI; luzDisparo.intensity = 40;
  efecto(arma.fogonazo, 0.06, () => { arma.fogonazo.visible = false; luzDisparo.intensity = 0; });
  const origen = arma.fogonazo.getWorldPosition(new THREE.Vector3());
  const linea = new THREE.Line(new THREE.BufferGeometry().setFromPoints([origen, puntoFinal]),
    new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, fog: false }));
  escena.add(efecto(linea, 0.09));
  return true;
}
function chispa(punto, color) {
  const m = new THREE.Mesh(geoChispa, new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(punto); m.geometry = geoChispa.clone();
  escena.add(efecto(m, 0.22));
}

// ----------------------------------------------------------------------------
// 9. Zombis (RF04 / RF05): modelo GLB, detección por distancia y persecución
// ----------------------------------------------------------------------------
const zombis = [];
let modeloZombi = null;

function crearZombi(c, f, corredor) {
  const raiz = modeloZombi.scene.clone(true); // misma geometría, nodos propios
  raiz.rotation.order = 'YXZ';
  raiz.position.copy(centroDe(c, f));
  raiz.rotation.y = Math.random() * Math.PI * 2;
  if (corredor) raiz.scale.setScalar(0.92);
  const z = {
    raiz, corredor, vivo: true, activo: false,
    vida: CONFIG.zombi.vida,                                   // 2 puntos de resistencia
    rango: (corredor ? CONFIG.corredor : CONFIG.zombi).rangoDeteccion,
    velocidad: (corredor ? CONFIG.corredor : CONFIG.zombi).velocidad * (0.9 + Math.random() * 0.2),
    destello: 0, caida: 0, materiales: [],
  };
  const tinte = new THREE.Color(0x9c1f1f);
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();                           // material propio para destellos individuales
    if (corredor) o.material.color.lerp(tinte, 0.45);
    o.userData.zombi = z;                                      // permite saber a qué zombi pertenece la malla impactada
    z.materiales.push({ m: o.material, emisivo: o.material.emissive.clone() });
  });
  // Animaciones incluidas en el GLB
  z.mezclador = new THREE.AnimationMixer(raiz);
  z.reposo = z.mezclador.clipAction(THREE.AnimationClip.findByName(modeloZombi.animations, 'Reposo'));
  z.caminar = z.mezclador.clipAction(THREE.AnimationClip.findByName(modeloZombi.animations, 'Caminar'));
  z.reposo.play(); z.reposo.time = Math.random() * 2;
  z.caminar.timeScale = corredor ? 2.1 : 1.15;
  escena.add(raiz); zombis.push(z);
}

function activarZombi(z) {
  if (z.activo || !z.vivo) return;
  z.activo = true;                                             // INACTIVO → ACTIVO
  z.caminar.reset().play(); z.reposo.crossFadeTo(z.caminar, 0.35, false);
  SONIDO.grunido();
}

function herirZombi(z, direccion) {
  z.vida -= 1;                                                 // cada impacto válido resta 1
  z.destello = 0.14;
  activarZombi(z);                                             // un disparo lo alerta aunque esté lejos
  moverConColision(z.raiz.position, direccion.x * 0.35, direccion.z * 0.35, CONFIG.zombi.radio); // empujón
  if (z.vida <= 0) {                                           // muere exactamente al segundo impacto
    z.vivo = false; z.activo = false; estadisticas.bajas++;
    z.mezclador.timeScale = 0;
  }
}

// Campo de distancias (BFS) desde la casilla del jugador: permite a los zombis
// rodear muros y encontrar las puertas en vez de atascarse contra las paredes.
const campo = new Int16Array(COLS * FILAS);
let celdaCampo = -1;
function actualizarCampo() {
  const c0 = aCelda(jugador.pos.x), f0 = aCelda(jugador.pos.z), id = f0 * COLS + c0;
  if (id === celdaCampo) return;
  celdaCampo = id; campo.fill(-1); campo[id] = 0;
  const cola = [id];
  for (let i = 0; i < cola.length; i++) {
    const act = cola[i], c = act % COLS, f = (act / COLS) | 0;
    for (const [dc, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nf = f + df, nid = nf * COLS + nc;
      if (esSolida(nc, nf) || campo[nid] !== -1) continue;
      campo[nid] = campo[act] + 1; cola.push(nid);
    }
  }
}
/** ¿Puede el zombi caminar en línea recta hasta el jugador sin chocar? */
function caminoDespejado(desde, hasta, r) {
  const dx = hasta.x - desde.x, dz = hasta.z - desde.z, d = Math.hypot(dx, dz), pasos = Math.ceil(d / 0.5);
  for (let i = 1; i < pasos; i++) if (hayColision(desde.x + dx * i / pasos, desde.z + dz * i / pasos, r)) return false;
  return true;
}

const _obj = new THREE.Vector3();
function actualizarZombis(dt) {
  const R = CONFIG.zombi.radio;
  for (const z of zombis) {
    const p = z.raiz.position;
    // Destello rojo al recibir un impacto
    if (z.destello > 0) {
      z.destello -= dt;
      for (const { m, emisivo } of z.materiales) z.destello > 0 ? m.emissive.setRGB(1, 0.15, 0.1) : m.emissive.copy(emisivo);
    }
    if (!z.vivo) { // animación de caída; un zombi muerto ya no persigue ni ataca
      if (z.caida < 1) {
        z.caida = Math.min(1, z.caida + dt / 0.6);
        const k = 1 - (1 - z.caida) ** 2;
        z.raiz.rotation.x = -Math.PI / 2 * k; p.y = 0.16 * k;
      }
      continue;
    }
    z.mezclador.update(dt);
    const dx = jugador.pos.x - p.x, dz = jugador.pos.z - p.z, dist = Math.hypot(dx, dz);

    // RF05 — Estado inactivo: no se mueve hasta que el jugador entra en su rango
    if (!z.activo) { if (dist <= z.rango) activarZombi(z); else continue; }

    // RF09 — contacto con el jugador
    if (dist < CONFIG.zombi.distanciaAtaque) { terminar('derrota'); return; }

    // RF05 — Estado activo: persecución
    _obj.copy(jugador.pos);
    if (!caminoDespejado(p, jugador.pos, R)) {
      const c = aCelda(p.x), f = aCelda(p.z);
      let mejor = campo[f * COLS + c]; if (mejor < 0) mejor = 32767;
      for (const [dc, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = campo[(f + df) * COLS + (c + dc)];
        if (v >= 0 && v < mejor && !esSolida(c + dc, f + df)) { mejor = v; _obj.copy(centroDe(c + dc, f + df)); }
      }
    }
    const ox = _obj.x - p.x, oz = _obj.z - p.z, od = Math.hypot(ox, oz) || 1;
    moverConColision(p, ox / od * z.velocidad * dt, oz / od * z.velocidad * dt, R);
    // Girar suavemente hacia la dirección de avance (el modelo mira hacia +Z)
    const objetivoY = Math.atan2(ox, oz);
    let dif = objetivoY - z.raiz.rotation.y; dif = Math.atan2(Math.sin(dif), Math.cos(dif));
    z.raiz.rotation.y += dif * Math.min(1, dt * 8);
  }
  // Separación entre zombis para que no se superpongan
  for (let i = 0; i < zombis.length; i++) for (let j = i + 1; j < zombis.length; j++) {
    const a = zombis[i], b = zombis[j];
    if (!a.vivo || !b.vivo || (!a.activo && !b.activo)) continue;
    const dx = b.raiz.position.x - a.raiz.position.x, dz = b.raiz.position.z - a.raiz.position.z, d = Math.hypot(dx, dz);
    if (d > 0.001 && d < 0.85) {
      const e = (0.85 - d) / 2 / d;
      if (a.activo) moverConColision(a.raiz.position, -dx * e, -dz * e, R);
      if (b.activo) moverConColision(b.raiz.position, dx * e, dz * e, R);
    }
  }
}

// ----------------------------------------------------------------------------
// 10. Coleccionables (RF10): caja de munición y adrenalina
// ----------------------------------------------------------------------------
const objetos = [];
function crearObjeto(tipo, c, f, modelo) {
  const grupo = new THREE.Group();
  const m = modelo.scene.clone(true); m.scale.setScalar(tipo === 'municion' ? 1.5 : 1.3);
  const color = tipo === 'municion' ? 0xffc93a : 0x18c8ff;
  const aro = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  aro.rotation.x = -Math.PI / 2; aro.position.y = 0.03;
  const luz = new THREE.PointLight(color, 8, 7, 1.8); luz.position.y = 1.2;
  grupo.add(m, aro, luz); grupo.position.copy(centroDe(c, f));
  escena.add(grupo);
  objetos.push({ tipo, grupo, modelo: m, fase: Math.random() * 6 });
}
function actualizarObjetos(dt) {
  for (let i = objetos.length - 1; i >= 0; i--) {
    const o = objetos[i];
    o.fase += dt; o.modelo.rotation.y += dt * 1.6; o.modelo.position.y = 0.45 + Math.sin(o.fase * 2.2) * 0.12;
    if (Math.hypot(o.grupo.position.x - jugador.pos.x, o.grupo.position.z - jugador.pos.z) > CONFIG.radioRecogida) continue;
    if (o.tipo === 'municion') {       // RF02: única forma de recuperar munición
      const { pistola, rifle } = CONFIG.cajaMunicion;
      armas[0].municion += pistola; armas[1].municion += rifle;
      aviso(`MUNICIÓN: +${pistola} pistola · +${rifle} rifle`, 'bueno');
    } else {
      jugador.impulso = CONFIG.adrenalina.duracion;
      aviso(`ADRENALINA: velocidad x${CONFIG.adrenalina.multiplicador} durante ${CONFIG.adrenalina.duracion} s`, 'bueno');
    }
    SONIDO.recoger(); o.grupo.removeFromParent(); objetos.splice(i, 1);
  }
}

// ----------------------------------------------------------------------------
// 11. Victoria y Game Over (RF08 / RF09)
// ----------------------------------------------------------------------------
function comprobarExtraccion() {
  if (celdaEn(aCelda(jugador.pos.x), aCelda(jugador.pos.z)) === 'E') terminar('victoria');
}
function terminar(resultado) {
  if (estado !== 'jugando') return;
  estado = resultado;                  // el bucle deja de actualizar el mundo: la partida se detiene
  document.exitPointerLock?.();
  const p = document.getElementById('pantalla-fin');
  p.className = `pantalla ${resultado}`;
  const precision = estadisticas.disparos ? Math.round(100 * estadisticas.impactos / estadisticas.disparos) : 0;
  document.getElementById('fin-datos').textContent =
    `Tiempo ${estadisticas.tiempo.toFixed(0)} s · Zombis eliminados ${estadisticas.bajas}/${zombis.length} · Precisión ${precision} %`;
  if (resultado === 'victoria') {
    document.getElementById('fin-titulo').textContent = '¡MISIÓN COMPLETADA!';
    document.getElementById('fin-texto').textContent = 'Has llegado a la zona de extracción.';
    SONIDO.victoria();
  } else {
    document.getElementById('fin-titulo').textContent = 'GAME OVER';
    document.getElementById('fin-texto').textContent = 'Un zombi te ha atrapado.';
    SONIDO.derrota();
  }
  document.getElementById('hud').classList.add('oculto');
}

// ----------------------------------------------------------------------------
// 12. HUD, estados de la aplicación y bucle principal
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
let temporizadorAviso = 0;
function aviso(texto, clase = '') {
  const a = $('aviso'); a.textContent = texto; a.className = `visible ${clase}`;
  clearTimeout(temporizadorAviso); temporizadorAviso = setTimeout(() => { a.className = clase; }, 2200);
}
function actualizarHUD() {
  if (!armas.length) return;
  const arma = armas[armaActual];
  $('arma-nombre').textContent = arma.cfg.nombre;
  $('balas').textContent = arma.municion;                      // munición del arma seleccionada
  $('municion').classList.toggle('vacio', arma.municion === 0);
  armas.forEach((a, i) => {
    const r = $(`ranura-${i}`); r.classList.toggle('activa', i === armaActual);
    r.querySelector('.n').textContent = a.cfg.nombre.split(' ')[0]; r.querySelector('b').textContent = a.municion;
  });
  const dx = zonaExtraccion.centro.x - jugador.pos.x, dz = zonaExtraccion.centro.z - jugador.pos.z;
  $('distancia').textContent = Math.hypot(dx, dz).toFixed(0);
  const sen = Math.sin(jugador.yaw), cos = Math.cos(jugador.yaw);
  const adelante = -dx * sen - dz * cos, derecha = dx * cos - dz * sen;
  $('flecha').style.transform = `rotate(${Math.atan2(derecha, adelante)}rad)`;
  $('bajas').textContent = estadisticas.bajas; $('total').textContent = zombis.length;
  $('impulso').classList.toggle('oculto', jugador.impulso <= 0);
  $('impulso-barra').style.width = `${100 * jugador.impulso / CONFIG.adrenalina.duracion}%`;
}

// Captura del puntero y pausa
$('btn-iniciar').addEventListener('click', () => {
  iniciarAudio();
  $('pantalla-inicio').classList.add('oculto'); $('hud').classList.remove('oculto');
  estado = 'jugando';
  capturarPuntero();
});
function capturarPuntero() {
  try { lienzo.requestPointerLock()?.catch?.(activarModoLibre); } catch { activarModoLibre(); }
}
function activarModoLibre() {
  if (document.pointerLockElement === lienzo) return;
  if (!modoLibre) aviso('Mouse libre: mueve el mouse (o ← →) para girar', 'bueno');
  modoLibre = true;
  if (estado === 'pausa') { estado = 'jugando'; $('pantalla-pausa').classList.add('oculto'); }
}
document.addEventListener('pointerlockerror', activarModoLibre);
$('pantalla-pausa').addEventListener('click', capturarPuntero);
$('btn-reiniciar').addEventListener('click', () => location.reload());
document.addEventListener('pointerlockchange', () => {
  const capturado = document.pointerLockElement === lienzo;
  if (capturado && estado === 'pausa') { estado = 'jugando'; $('pantalla-pausa').classList.add('oculto'); }
  else if (!capturado && estado === 'jugando' && !modoLibre) { estado = 'pausa'; teclas.clear(); $('pantalla-pausa').classList.remove('oculto'); }
});

const reloj = new THREE.Clock();
/** Avanza la simulación dt segundos (lógica del juego, sin dibujar). */
function paso(dt) {
  if (estado === 'jugando') {
    estadisticas.tiempo += dt;
    actualizarJugador(dt);
    actualizarCampo();
    actualizarZombis(dt);
    if (estado === 'jugando') { actualizarObjetos(dt); comprobarExtraccion(); }
  }
  actualizarEfectos(dt);
  actualizarArmaVista(dt);
  if (zonaExtraccion.haz) zonaExtraccion.haz.material.opacity = 0.18 + Math.sin(performance.now() / 400) * 0.06;
  if (estado === 'jugando') actualizarHUD();
}

function bucle() {
  requestAnimationFrame(bucle);
  paso(Math.min(reloj.getDelta(), 0.05));

  // Pasada 1: el mundo.  Pasada 2: el arma, tras limpiar la profundidad,
  // para que nunca se "meta" dentro de un muro cercano.
  renderer.clear();
  camara.layers.set(0); renderer.render(escena, camara);
  renderer.clearDepth();
  camara.layers.set(CAPA_ARMA); renderer.render(escena, camara);
}

async function iniciar() {
  const cargador = new GLTFLoader().setPath('assets/models/');
  const nombres = ['pistola', 'rifle', 'zombi', 'caja_municion', 'adrenalina'];
  const cargados = await Promise.all(nombres.map((n) => cargador.loadAsync(`${n}.glb`)));
  const modelos = Object.fromEntries(nombres.map((n, i) => [n, cargados[i]]));
  modeloZombi = modelos.zombi;

  construirMundo();
  crearArmas(modelos);
  for (let f = 0; f < FILAS; f++) for (let c = 0; c < COLS; c++) {
    const k = MAPA[f][c];
    if (k === 'Z' || k === 'R') crearZombi(c, f, k === 'R');
    if (k === 'A') crearObjeto('municion', c, f, modelos.caja_municion);
    if (k === 'V') crearObjeto('adrenalina', c, f, modelos.adrenalina);
  }
  // Las luces deben iluminar también la capa del arma
  // (menos la linterna, que a tan corta distancia la quemaría)
  escena.traverse((o) => { if (o.isLight && o !== linterna) o.layers.enable(CAPA_ARMA); });

  jugador.pos.copy(inicioJugador);
  actualizarJugador(0); actualizarHUD();
  estado = 'inicio';
  const b = $('btn-iniciar'); b.disabled = false; b.textContent = 'INICIAR MISIÓN';
}

iniciar().catch((err) => {
  console.error(err);
  $('btn-iniciar').textContent = 'Error al cargar (ver consola)';
});
bucle();

// Acceso desde la consola del navegador para depurar y verificar las mecánicas
window.__juego = { CONFIG, MAPA, jugador, zombis, armas, objetos, estadisticas, camara, disparar, seleccionarArma,
  simular: (segundos) => { for (let t = 0; t < segundos; t += 1 / 60) paso(1 / 60); },
  get estado() { return estado; }, get armaActual() { return armaActual; } };
