// ============================================================================
//  generar_modelos.mjs
//  Genera los modelos 3D del juego en formato binario glTF 2.0 (.glb) sin
//  dependencias externas. Los modelos son originales (hechos con primitivas),
//  por lo que no tienen restricciones de licencia.
//
//  Uso:  node tools/generar_modelos.mjs
//  Salida: assets/models/{pistola,rifle,zombi,caja_municion,adrenalina}.glb
// ============================================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models');
mkdirSync(SALIDA, { recursive: true });

const FLOAT = 5126, USHORT = 5123, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

/** Convierte ángulos de Euler (grados, orden XYZ) a cuaternión [x,y,z,w]. */
function cuat([gx = 0, gy = 0, gz = 0]) {
  const k = Math.PI / 360;
  const c1 = Math.cos(gx * k), c2 = Math.cos(gy * k), c3 = Math.cos(gz * k);
  const s1 = Math.sin(gx * k), s2 = Math.sin(gy * k), s3 = Math.sin(gz * k);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function hexARgb(hex) {
  // sRGB -> lineal (glTF guarda baseColorFactor en espacio lineal)
  const aLineal = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => aLineal(v / 255));
}

class ConstructorGLB {
  constructor() {
    this.nodos = []; this.mallas = []; this.materiales = []; this.accesores = [];
    this.vistas = []; this.trozos = []; this.bytes = 0; this.animaciones = [];
    this.raices = []; this.cacheMat = new Map(); this.cacheMalla = new Map();
    this.geometrias = { caja: this.#geomCaja(), cilindro: this.#geomCilindro(14) };
  }

  #vista(arr, destino) {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const relleno = (4 - (buf.length % 4)) % 4;
    const v = { buffer: 0, byteOffset: this.bytes, byteLength: buf.length };
    if (destino) v.target = destino;
    this.trozos.push(buf, Buffer.alloc(relleno));
    this.bytes += buf.length + relleno;
    return this.vistas.push(v) - 1;
  }

  #accesor(arr, tipo, tipoComp, destino, conMinMax = false) {
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[tipo];
    const a = { bufferView: this.#vista(arr, destino), componentType: tipoComp, count: arr.length / n, type: tipo };
    if (conMinMax) {
      a.min = Array(n).fill(Infinity); a.max = Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        a.min[i % n] = Math.min(a.min[i % n], arr[i]);
        a.max[i % n] = Math.max(a.max[i % n], arr[i]);
      }
    }
    return this.accesores.push(a) - 1;
  }

  #registrarGeom(pos, nor, idx) {
    return {
      POSITION: this.#accesor(new Float32Array(pos), 'VEC3', FLOAT, ARRAY_BUFFER, true),
      NORMAL: this.#accesor(new Float32Array(nor), 'VEC3', FLOAT, ARRAY_BUFFER),
      indices: this.#accesor(new Uint16Array(idx), 'SCALAR', USHORT, ELEMENT_ARRAY_BUFFER),
    };
  }

  /** Cubo unitario centrado en el origen (24 vértices, normales por cara). */
  #geomCaja() {
    const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
    const neg = (v) => v.map((c) => -c);
    // [normal, u, v] con u × v = normal  ->  triángulos en sentido antihorario
    const caras = [[X, Y, Z], [neg(X), Z, Y], [Y, Z, X], [neg(Y), X, Z], [Z, X, Y], [neg(Z), Y, X]];
    const pos = [], nor = [], idx = [];
    caras.forEach(([n, u, v], c) => {
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(...n.map((_, i) => 0.5 * (n[i] + su * u[i] + sv * v[i])));
        nor.push(...n);
      }
      const b = c * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    return this.#registrarGeom(pos, nor, idx);
  }

  /** Cilindro unitario (diámetro 1, altura 1) con eje en Y. */
  #geomCilindro(seg) {
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * 0.5, -0.5, s * 0.5, c * 0.5, 0.5, s * 0.5);
      nor.push(c, 0, s, c, 0, s);
    }
    for (let i = 0; i < seg; i++) {
      const b = 2 * i, t = b + 1, b2 = b + 2, t2 = b + 3;
      idx.push(b, t, t2, b, t2, b2);
    }
    for (const signo of [1, -1]) {
      const centro = pos.length / 3;
      pos.push(0, signo * 0.5, 0); nor.push(0, signo, 0);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * 0.5, signo * 0.5, Math.sin(a) * 0.5); nor.push(0, signo, 0);
      }
      for (let i = 0; i < seg; i++) {
        const p = centro + 1 + i;
        if (signo > 0) idx.push(centro, p + 1, p); else idx.push(centro, p, p + 1);
      }
    }
    return this.#registrarGeom(pos, nor, idx);
  }

  #material({ color, metal = 0, rugosidad = 0.8, emisivo = 0 }) {
    const clave = `${color}|${metal}|${rugosidad}|${emisivo}`;
    if (!this.cacheMat.has(clave)) {
      const m = {
        name: `mat_${color.toString(16)}`,
        pbrMetallicRoughness: { baseColorFactor: [...hexARgb(color), 1], metallicFactor: metal, roughnessFactor: rugosidad },
      };
      if (emisivo) m.emissiveFactor = hexARgb(emisivo);
      this.cacheMat.set(clave, this.materiales.push(m) - 1);
    }
    return this.cacheMat.get(clave);
  }

  #malla(geom, mat) {
    const clave = `${geom}|${mat}`;
    if (!this.cacheMalla.has(clave)) {
      const g = this.geometrias[geom];
      this.cacheMalla.set(clave, this.mallas.push({
        primitives: [{ attributes: { POSITION: g.POSITION, NORMAL: g.NORMAL }, indices: g.indices, material: mat }],
      }) - 1);
    }
    return this.cacheMalla.get(clave);
  }

  #agregar(nodo, padre) {
    const i = this.nodos.push(nodo) - 1;
    if (padre === undefined) this.raices.push(i);
    else (this.nodos[padre].children ??= []).push(i);
    return i;
  }

  /** Nodo vacío (articulación). Las animaciones rotan estos nodos. */
  articulacion(nombre, padre, pos = [0, 0, 0], rot = [0, 0, 0]) {
    return this.#agregar({ name: nombre, translation: pos, rotation: cuat(rot) }, padre);
  }

  /** Pieza visible: caja o cilindro escalado. */
  pieza(nombre, padre, geom, tam, pos, mat, rot = [0, 0, 0]) {
    return this.#agregar({
      name: nombre, translation: pos, rotation: cuat(rot), scale: tam,
      mesh: this.#malla(geom, this.#material(mat)),
    }, padre);
  }

  /** pistas: [{ nodo, tiempos:[...], rot:[[x,y,z] en grados, ...] }] */
  animacion(nombre, pistas) {
    const anim = { name: nombre, samplers: [], channels: [] };
    for (const p of pistas) {
      const entrada = this.#accesor(new Float32Array(p.tiempos), 'SCALAR', FLOAT, undefined, true);
      const salida = this.#accesor(new Float32Array(p.rot.flatMap(cuat)), 'VEC4', FLOAT);
      const s = anim.samplers.push({ input: entrada, output: salida, interpolation: 'LINEAR' }) - 1;
      anim.channels.push({ sampler: s, target: { node: p.nodo, path: 'rotation' } });
    }
    this.animaciones.push(anim);
  }

  guardar(archivo) {
    const json = {
      asset: { version: '2.0', generator: 'Operacion Extraccion - generar_modelos.mjs' },
      scene: 0, scenes: [{ nodes: this.raices }],
      nodes: this.nodos, meshes: this.mallas, materials: this.materiales,
      accessors: this.accesores, bufferViews: this.vistas, buffers: [{ byteLength: this.bytes }],
    };
    if (this.animaciones.length) json.animations = this.animaciones;
    let txt = Buffer.from(JSON.stringify(json), 'utf8');
    txt = Buffer.concat([txt, Buffer.alloc((4 - (txt.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(this.trozos);
    const cab = Buffer.alloc(12), cabJson = Buffer.alloc(8), cabBin = Buffer.alloc(8);
    cab.writeUInt32LE(0x46546c67, 0); cab.writeUInt32LE(2, 4);
    cab.writeUInt32LE(12 + 8 + txt.length + 8 + bin.length, 8);
    cabJson.writeUInt32LE(txt.length, 0); cabJson.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    cabBin.writeUInt32LE(bin.length, 0); cabBin.writeUInt32LE(0x004e4942, 4);   // 'BIN'
    const ruta = join(SALIDA, archivo);
    writeFileSync(ruta, Buffer.concat([cab, cabJson, txt, cabBin, bin]));
    console.log(`✔ ${archivo}  (${12 + 16 + txt.length + bin.length} bytes, ${this.nodos.length} nodos)`);
  }
}

// ---------------------------------------------------------------------------
//  Materiales comunes
// ---------------------------------------------------------------------------
const ACERO = { color: 0x2b2e34, metal: 0.85, rugosidad: 0.35 };
const ACERO_OSCURO = { color: 0x15161a, metal: 0.8, rugosidad: 0.45 };
const POLIMERO = { color: 0x1d1f22, metal: 0.1, rugosidad: 0.7 };
const MADERA = { color: 0x6b4226, metal: 0, rugosidad: 0.75 };
const LATON = { color: 0xc9a23a, metal: 0.9, rugosidad: 0.3 };

// ---------------------------------------------------------------------------
//  ARMA 1 — Pistola   (apunta hacia -Z, arriba +Y, unidades en metros)
// ---------------------------------------------------------------------------
{
  const g = new ConstructorGLB();
  const r = g.articulacion('Pistola');
  g.pieza('Corredera', r, 'caja', [0.032, 0.04, 0.2], [0, 0.06, -0.06], ACERO);
  g.pieza('Armazon', r, 'caja', [0.03, 0.026, 0.15], [0, 0.029, -0.045], POLIMERO);
  g.pieza('Canon', r, 'cilindro', [0.016, 0.03, 0.016], [0, 0.062, -0.172], ACERO_OSCURO, [90, 0, 0]);
  g.pieza('Empunadura', r, 'caja', [0.03, 0.115, 0.046], [0, -0.035, 0.022], MADERA, [-12, 0, 0]);
  g.pieza('Guardamonte', r, 'caja', [0.008, 0.006, 0.055], [0, -0.012, -0.04], POLIMERO);
  g.pieza('GuardamonteFrente', r, 'caja', [0.008, 0.03, 0.006], [0, 0.003, -0.066], POLIMERO);
  g.pieza('Gatillo', r, 'caja', [0.006, 0.022, 0.006], [0, 0.006, -0.032], ACERO_OSCURO, [15, 0, 0]);
  g.pieza('MiraTrasera', r, 'caja', [0.014, 0.008, 0.008], [0, 0.084, 0.03], ACERO_OSCURO);
  g.pieza('MiraDelantera', r, 'caja', [0.004, 0.008, 0.006], [0, 0.084, -0.15], { color: 0x33ff66, emisivo: 0x22aa44 });
  g.pieza('Martillo', r, 'caja', [0.01, 0.016, 0.012], [0, 0.068, 0.044], ACERO_OSCURO, [-20, 0, 0]);
  g.pieza('Ventana', r, 'caja', [0.034, 0.012, 0.04], [0, 0.07, -0.03], LATON);
  g.guardar('pistola.glb');
}

// ---------------------------------------------------------------------------
//  ARMA 2 — Rifle de cerrojo con mira
// ---------------------------------------------------------------------------
{
  const g = new ConstructorGLB();
  const r = g.articulacion('Rifle');
  g.pieza('Canon', r, 'cilindro', [0.022, 0.52, 0.022], [0, 0.05, -0.5], ACERO_OSCURO, [90, 0, 0]);
  g.pieza('BocaFuego', r, 'cilindro', [0.03, 0.05, 0.03], [0, 0.05, -0.75], ACERO, [90, 0, 0]);
  g.pieza('Guardamano', r, 'caja', [0.042, 0.042, 0.32], [0, 0.03, -0.33], MADERA);
  g.pieza('Cajon', r, 'caja', [0.046, 0.062, 0.24], [0, 0.04, -0.06], ACERO);
  g.pieza('Culata', r, 'caja', [0.04, 0.095, 0.3], [0, 0.005, 0.2], MADERA, [-7, 0, 0]);
  g.pieza('Cantonera', r, 'caja', [0.042, 0.11, 0.02], [0, -0.012, 0.355], POLIMERO, [-7, 0, 0]);
  g.pieza('Empunadura', r, 'caja', [0.034, 0.09, 0.04], [0, -0.035, 0.05], MADERA, [-22, 0, 0]);
  g.pieza('Cargador', r, 'caja', [0.03, 0.08, 0.05], [0, -0.03, -0.09], ACERO_OSCURO, [6, 0, 0]);
  g.pieza('Gatillo', r, 'caja', [0.006, 0.022, 0.006], [0, -0.002, 0.0], ACERO_OSCURO, [15, 0, 0]);
  g.pieza('Mira', r, 'cilindro', [0.036, 0.22, 0.036], [0, 0.115, -0.06], POLIMERO, [90, 0, 0]);
  g.pieza('MiraObjetivo', r, 'cilindro', [0.048, 0.04, 0.048], [0, 0.115, -0.19], POLIMERO, [90, 0, 0]);
  g.pieza('MiraLente', r, 'cilindro', [0.03, 0.006, 0.03], [0, 0.115, 0.052], { color: 0x224466, emisivo: 0x1b5fa8 }, [90, 0, 0]);
  g.pieza('MonturaA', r, 'caja', [0.016, 0.03, 0.02], [0, 0.085, -0.12], ACERO);
  g.pieza('MonturaB', r, 'caja', [0.016, 0.03, 0.02], [0, 0.085, 0.0], ACERO);
  g.pieza('Cerrojo', r, 'cilindro', [0.012, 0.06, 0.012], [0.04, 0.05, 0.02], ACERO, [0, 0, 90]);
  g.pieza('PomoCerrojo', r, 'caja', [0.02, 0.02, 0.02], [0.072, 0.045, 0.02], POLIMERO);
  g.guardar('rifle.glb');
}

// ---------------------------------------------------------------------------
//  ENEMIGO — Zombi articulado con animaciones "Reposo" y "Caminar"
//  (mira hacia +Z, pies en y = 0, altura ≈ 1.85 m)
// ---------------------------------------------------------------------------
{
  const PIEL = { color: 0x6f8f52, rugosidad: 0.9 };
  const PIEL_OSCURA = { color: 0x4f6b3a, rugosidad: 0.9 };
  const CAMISA = { color: 0x5a4a3c, rugosidad: 0.95 };
  const PANTALON = { color: 0x2b3345, rugosidad: 0.95 };
  const SANGRE = { color: 0x6e0d0d, rugosidad: 0.6 };
  const OJO = { color: 0xffd23a, emisivo: 0xff5a1a };
  const ZAPATO = { color: 0x1a1612, rugosidad: 0.8 };

  const g = new ConstructorGLB();
  const raiz = g.articulacion('Zombi');
  const cadera = g.articulacion('Cadera', raiz, [0, 0.95, 0]);
  g.pieza('Torso', cadera, 'caja', [0.52, 0.62, 0.28], [0, 0.31, 0], CAMISA);
  g.pieza('Herida', cadera, 'caja', [0.2, 0.22, 0.02], [0.08, 0.36, 0.14], SANGRE);
  g.pieza('Cinturon', cadera, 'caja', [0.5, 0.1, 0.27], [0, 0.0, 0], PANTALON);

  const cabeza = g.articulacion('Cabeza', cadera, [0, 0.64, 0]);
  g.pieza('Cuello', cabeza, 'caja', [0.14, 0.08, 0.14], [0, 0.02, 0], PIEL_OSCURA);
  g.pieza('Craneo', cabeza, 'caja', [0.3, 0.3, 0.3], [0, 0.2, 0], PIEL);
  g.pieza('Pelo', cabeza, 'caja', [0.31, 0.07, 0.31], [0, 0.345, -0.01], { color: 0x231c16, rugosidad: 1 });
  g.pieza('OjoIzq', cabeza, 'caja', [0.06, 0.045, 0.02], [0.075, 0.235, 0.15], OJO);
  g.pieza('OjoDer', cabeza, 'caja', [0.06, 0.045, 0.02], [-0.075, 0.235, 0.15], OJO);
  g.pieza('Boca', cabeza, 'caja', [0.16, 0.05, 0.02], [0, 0.115, 0.15], SANGRE);
  g.pieza('Mandibula', cabeza, 'caja', [0.2, 0.06, 0.1], [0, 0.07, 0.1], PIEL_OSCURA);

  const brazo = (lado, x) => {
    const b = g.articulacion(`Brazo${lado}`, cadera, [x, 0.56, 0]);
    g.pieza(`Manga${lado}`, b, 'caja', [0.15, 0.28, 0.15], [0, -0.12, 0], CAMISA);
    g.pieza(`Antebrazo${lado}`, b, 'caja', [0.12, 0.34, 0.12], [0, -0.42, 0], PIEL);
    g.pieza(`Mano${lado}`, b, 'caja', [0.13, 0.12, 0.08], [0, -0.64, 0], PIEL_OSCURA);
    return b;
  };
  const brazoIzq = brazo('Izq', 0.34), brazoDer = brazo('Der', -0.34);

  const pierna = (lado, x) => {
    const p = g.articulacion(`Pierna${lado}`, cadera, [x, -0.02, 0]);
    g.pieza(`Muslo${lado}`, p, 'caja', [0.2, 0.84, 0.2], [0, -0.42, 0], PANTALON);
    g.pieza(`Pie${lado}`, p, 'caja', [0.2, 0.1, 0.3], [0, -0.88, 0.05], ZAPATO);
    return p;
  };
  const piernaIzq = pierna('Izq', 0.14), piernaDer = pierna('Der', -0.14);

  // Reposo: brazos caídos, balanceo lento (zombi fuera del rango de detección)
  const t3 = [0, 1, 2];
  g.animacion('Reposo', [
    { nodo: cadera, tiempos: t3, rot: [[4, 0, 2.5], [4, 0, -2.5], [4, 0, 2.5]] },
    { nodo: cabeza, tiempos: t3, rot: [[22, 0, -7], [18, 0, 7], [22, 0, -7]] },
    { nodo: brazoIzq, tiempos: t3, rot: [[-4, 0, 4], [-10, 0, 6], [-4, 0, 4]] },
    { nodo: brazoDer, tiempos: t3, rot: [[-8, 0, -6], [-3, 0, -4], [-8, 0, -6]] },
    { nodo: piernaIzq, tiempos: t3, rot: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
    { nodo: piernaDer, tiempos: t3, rot: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
  ]);

  // Caminar: brazos extendidos al frente y zancadas (zombi persiguiendo)
  const t5 = [0, 0.25, 0.5, 0.75, 1];
  g.animacion('Caminar', [
    { nodo: cadera, tiempos: t5, rot: [[10, 0, 4], [10, 0, 0], [10, 0, -4], [10, 0, 0], [10, 0, 4]] },
    { nodo: cabeza, tiempos: t5, rot: [[-4, 0, -9], [-4, 0, 0], [-4, 0, 9], [-4, 0, 0], [-4, 0, -9]] },
    { nodo: brazoIzq, tiempos: t5, rot: [[-92, 0, 0], [-84, 0, 0], [-92, 0, 0], [-100, 0, 0], [-92, 0, 0]] },
    { nodo: brazoDer, tiempos: t5, rot: [[-80, 0, 0], [-92, 0, 0], [-80, 0, 0], [-70, 0, 0], [-80, 0, 0]] },
    { nodo: piernaIzq, tiempos: t5, rot: [[-10 + 32, 0, 0], [-10, 0, 0], [-10 - 32, 0, 0], [-10, 0, 0], [-10 + 32, 0, 0]] },
    { nodo: piernaDer, tiempos: t5, rot: [[-10 - 32, 0, 0], [-10, 0, 0], [-10 + 32, 0, 0], [-10, 0, 0], [-10 - 32, 0, 0]] },
  ]);
  g.guardar('zombi.glb');
}

// ---------------------------------------------------------------------------
//  COLECCIONABLE 1 — Caja de munición
// ---------------------------------------------------------------------------
{
  const VERDE = { color: 0x4b5a2a, metal: 0.3, rugosidad: 0.7 };
  const g = new ConstructorGLB();
  const r = g.articulacion('CajaMunicion');
  g.pieza('Cuerpo', r, 'caja', [0.56, 0.3, 0.3], [0, 0.15, 0], VERDE);
  g.pieza('Tapa', r, 'caja', [0.58, 0.05, 0.32], [0, 0.32, 0], { color: 0x3a4620, metal: 0.3, rugosidad: 0.7 });
  g.pieza('Franja', r, 'caja', [0.12, 0.31, 0.31], [0, 0.15, 0], { color: 0xe0b020, emisivo: 0x6b5200 });
  g.pieza('Asa', r, 'caja', [0.2, 0.03, 0.04], [0, 0.37, 0], ACERO);
  for (let i = 0; i < 4; i++) {
    g.pieza(`Bala${i}`, r, 'cilindro', [0.035, 0.12, 0.035], [-0.2 + i * 0.045, 0.41, 0.09], LATON);
    g.pieza(`Punta${i}`, r, 'cilindro', [0.022, 0.04, 0.022], [-0.2 + i * 0.045, 0.49, 0.09], { color: 0xb5651d, metal: 0.9, rugosidad: 0.3 });
  }
  g.guardar('caja_municion.glb');
}

// ---------------------------------------------------------------------------
//  COLECCIONABLE 2 — Inyector de adrenalina (potenciador de velocidad)
// ---------------------------------------------------------------------------
{
  const g = new ConstructorGLB();
  const r = g.articulacion('Adrenalina');
  g.pieza('Tubo', r, 'cilindro', [0.14, 0.34, 0.14], [0, 0.27, 0], { color: 0x18c8ff, emisivo: 0x0a7fd0, rugosidad: 0.2 });
  g.pieza('Tapa', r, 'cilindro', [0.17, 0.06, 0.17], [0, 0.47, 0], { color: 0xf2f2f2, rugosidad: 0.4 });
  g.pieza('Base', r, 'cilindro', [0.17, 0.06, 0.17], [0, 0.07, 0], { color: 0xf2f2f2, rugosidad: 0.4 });
  g.pieza('Embolo', r, 'cilindro', [0.05, 0.14, 0.05], [0, 0.57, 0], ACERO);
  g.pieza('Boton', r, 'cilindro', [0.12, 0.03, 0.12], [0, 0.65, 0], { color: 0xff3b30, emisivo: 0x801010 });
  g.pieza('Aguja', r, 'cilindro', [0.012, 0.08, 0.012], [0, 0.0, 0], ACERO);
  g.guardar('adrenalina.glb');
}
