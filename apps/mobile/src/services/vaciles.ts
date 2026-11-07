/**
 * Las pestañas de vaciles que se escriben desde el panel (§9-sexies del
 * CLAUDE.md). Los Clásicos y los de Halloween van dibujados dentro de la app;
 * estas llegan del servidor y el selector las pone al lado, sin sacar versión.
 * Las hay de dos tipos: de TEXTO (frases que se pintan en una tarjeta) y de
 * CARTELES (parejas de PNG como los clásicos, que el servidor guarda y sirve;
 * cada uno trae además un texto de reserva por si el dibujo no llega).
 *
 * Con ellas viene si a este corredor le sale la pestaña HALLOWEEN (dibujada
 * en la app, pero con su interruptor en el panel como las demás): fuera de
 * temporada no está, y sin saber nada tampoco.
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

export interface VacilesEnMovil {
  pestanas: PestanaVaciles[];
  /** ¿Sale la pestaña HALLOWEEN? (la de la app, encendida desde el panel). */
  halloween: boolean;
}

const CLAVE = 'corrr_vaciles_panel_v1';
const SIN_NADA: VacilesEnMovil = { pestanas: [], halloween: false };
let enMemoria: VacilesEnMovil | null = null;

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
 *  pestaña a medias no puede romper el selector. Vale la forma de ahora
 *  (`{ pestanas, halloween }`) y la lista a secas que se guardaba antes. */
function limpiar(crudo: unknown): VacilesEnMovil {
  const lista = Array.isArray(crudo) ? crudo : (crudo as any)?.pestanas;
  const limpias: PestanaVaciles[] = [];
  for (const p of (Array.isArray(lista) ? lista : []) as any[]) {
    if (!p || typeof p.id !== 'number' || typeof p.nombre !== 'string' || !p.nombre.trim()) continue;
    const mensajes = textos(p.mensajes);
    if (mensajes.length === 0) continue;
    const respuestas = textos(p.respuestas);
    limpias.push({
      id: p.id, nombre: p.nombre.trim(), tipo: p.tipo === 'imagen' ? 'imagen' : 'texto',
      mensajes, respuestas: respuestas.length ? respuestas : mensajes,
    });
  }
  return { pestanas: limpias, halloween: !Array.isArray(crudo) && (crudo as any)?.halloween === true };
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
export async function vacilesGuardados(): Promise<VacilesEnMovil> {
  if (enMemoria) return enMemoria;
  try {
    const raw = await AsyncStorage.getItem(CLAVE);
    enMemoria = limpiar(raw ? JSON.parse(raw) : null);
  } catch {
    enMemoria = SIN_NADA;
  }
  precargarCarteles(enMemoria.pestanas).catch(() => {});
  return enMemoria;
}

/** Pregunta al servidor y guarda. null = no ha contestado (se deja lo de antes). */
export async function refrescarVaciles(): Promise<VacilesEnMovil | null> {
  const res = await api.getVaciles();
  if (res === undefined) return null;
  enMemoria = limpiar(res);
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(enMemoria)); } catch {}
  precargarCarteles(enMemoria.pestanas).catch(() => {});
  return enMemoria;
}

/** Las pestañas del panel (y si sale Halloween) para el selector: primero lo
 *  guardado, y al abrirse (`abierto`) se vuelve a preguntar al servidor. */
export function useVaciles(abierto: boolean): VacilesEnMovil {
  const [vaciles, setVaciles] = useState<VacilesEnMovil>(enMemoria ?? SIN_NADA);
  useEffect(() => {
    let vivo = true;
    vacilesGuardados().then(v => { if (vivo) setVaciles(v); });
    refrescarVaciles().then(v => { if (vivo && v) setVaciles(v); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    refrescarVaciles().then(v => { if (vivo && v) setVaciles(v); }).catch(() => {});
    return () => { vivo = false; };
  }, [abierto]);
  return vaciles;
}

/** `{nombre}` es quien recibe el vacile. Al elegirlo se enseña con el nombre
 *  del rival; a quien lo recibe ya le llega puesto desde el servidor. */
export function conNombre(texto: string, nombre?: string | null): string {
  return texto.replace(/\{nombre\}/gi, (nombre ?? '').trim() || 'rival');
}
