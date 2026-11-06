/**
 * Las pestañas de vaciles que se escriben desde el panel (§9-sexies del
 * CLAUDE.md). Los Clásicos y los de Halloween van dibujados dentro de la app;
 * estas llegan del servidor y el selector las pone al lado, sin sacar versión.
 * Las hay de dos tipos: de TEXTO (frases que se pintan en una tarjeta) y de
 * CARTELES (parejas de PNG como los clásicos, que el servidor guarda y sirve;
 * cada uno trae además un texto de reserva por si el dibujo no llega).
 *
 * Se piden al arrancar y cada vez que se abre el selector, y lo último
 * recibido se guarda en el móvil: así salen al momento, y sin red se enseña
 * lo de la última vez. Si el servidor no contesta no se borra nada; solo una
 * respuesta de verdad (aunque diga «ninguna») cambia lo guardado. Los carteles
 * se bajan por adelantado (`Image.prefetch`) con un tope de tiempo, como hace
 * `prepararTipos` con los logos de las campañas.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { useEffect, useState } from 'react';
import { api, MensajeVacile, PestanaVaciles } from './api';

const CLAVE = 'corrr_vaciles_panel_v1';
let enMemoria: PestanaVaciles[] | null = null;

const esDireccion = (x: unknown): x is string => typeof x === 'string' && /^https?:\/\//.test(x);

function textos(lista: unknown): MensajeVacile[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((m: any) => m && typeof m.id === 'number' && typeof m.texto === 'string' && m.texto.trim())
    .map((m: any) => ({
      id: m.id,
      texto: String(m.texto),
      imagen: esDireccion(m.imagen) ? m.imagen : null,
      miniatura: esDireccion(m.miniatura) ? m.miniatura : (esDireccion(m.imagen) ? m.imagen : null),
    }));
}

/** Lo que llega (del servidor o del disco) se mira antes de usarlo: una
 *  pestaña a medias no puede romper el selector. */
function limpiar(crudo: unknown): PestanaVaciles[] {
  if (!Array.isArray(crudo)) return [];
  const limpias: PestanaVaciles[] = [];
  for (const p of crudo as any[]) {
    if (!p || typeof p.id !== 'number' || typeof p.nombre !== 'string' || !p.nombre.trim()) continue;
    const mensajes = textos(p.mensajes);
    if (mensajes.length === 0) continue;
    const respuestas = textos(p.respuestas);
    limpias.push({
      id: p.id, nombre: p.nombre.trim(), tipo: p.tipo === 'imagen' ? 'imagen' : 'texto',
      mensajes, respuestas: respuestas.length ? respuestas : mensajes,
    });
  }
  return limpias;
}

/** Los carteles ya pedidos esta sesión: no se vuelven a pedir. */
const pedidas = new Set<string>();

/** Baja por adelantado los carteles de las pestañas (miniaturas primero, que
 *  son lo que se ve en la cuadrícula), con tope de tiempo: si la red va mal,
 *  la app sigue y el que falte se pinta como tarjeta de texto. */
export async function precargarCarteles(pestanas: PestanaVaciles[], msTope = 8000): Promise<void> {
  const direcciones: string[] = [];
  for (const p of pestanas) {
    for (const m of [...p.mensajes, ...p.respuestas]) {
      if (m.miniatura && !pedidas.has(m.miniatura)) direcciones.push(m.miniatura);
    }
  }
  for (const p of pestanas) {
    for (const m of [...p.mensajes, ...p.respuestas]) {
      if (m.imagen && !pedidas.has(m.imagen)) direcciones.push(m.imagen);
    }
  }
  if (direcciones.length === 0) return;
  for (const d of direcciones) pedidas.add(d);
  const bajadas = Promise.all(direcciones.map(d => Image.prefetch(d).catch(() => { pedidas.delete(d); return false; })));
  const tope = new Promise<void>(r => setTimeout(r, msTope));
  await Promise.race([bajadas.then(() => undefined), tope]);
}

/** Lo guardado en el móvil la última vez. */
export async function vacilesGuardados(): Promise<PestanaVaciles[]> {
  if (enMemoria) return enMemoria;
  try {
    const raw = await AsyncStorage.getItem(CLAVE);
    enMemoria = limpiar(raw ? JSON.parse(raw) : []);
  } catch {
    enMemoria = [];
  }
  precargarCarteles(enMemoria).catch(() => {});
  return enMemoria;
}

/** Pregunta al servidor y guarda. null = no ha contestado (se deja lo de antes). */
export async function refrescarVaciles(): Promise<PestanaVaciles[] | null> {
  const res = await api.getVaciles();
  if (res === undefined) return null;
  enMemoria = limpiar(res);
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(enMemoria)); } catch {}
  precargarCarteles(enMemoria).catch(() => {});
  return enMemoria;
}

/** Las pestañas del panel para el selector: primero lo guardado, y al abrirse
 *  (`abierto`) se vuelve a preguntar al servidor. */
export function useVaciles(abierto: boolean): PestanaVaciles[] {
  const [pestanas, setPestanas] = useState<PestanaVaciles[]>(enMemoria ?? []);
  useEffect(() => {
    let vivo = true;
    vacilesGuardados().then(p => { if (vivo) setPestanas(p); });
    refrescarVaciles().then(p => { if (vivo && p) setPestanas(p); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    refrescarVaciles().then(p => { if (vivo && p) setPestanas(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [abierto]);
  return pestanas;
}

/** `{nombre}` es quien recibe el vacile. Al elegirlo se enseña con el nombre
 *  del rival; a quien lo recibe ya le llega puesto desde el servidor. */
export function conNombre(texto: string, nombre?: string | null): string {
  return texto.replace(/\{nombre\}/gi, (nombre ?? '').trim() || 'rival');
}
