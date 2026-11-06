/**
 * Las pestañas de vaciles que se escriben desde el panel (§9-sexies del
 * CLAUDE.md). Los Clásicos y los de Halloween van dibujados dentro de la app;
 * estas llegan como texto y el selector las pone al lado, sin sacar versión.
 *
 * Se piden al arrancar y cada vez que se abre el selector, y lo último
 * recibido se guarda en el móvil: así salen al momento, y sin red se enseña
 * lo de la última vez. Si el servidor no contesta no se borra nada; solo una
 * respuesta de verdad (aunque diga «ninguna») cambia lo guardado.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { api, PestanaVaciles } from './api';

const CLAVE = 'corrr_vaciles_panel_v1';
let enMemoria: PestanaVaciles[] | null = null;

function textos(lista: unknown): { id: number; texto: string }[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((m: any) => m && typeof m.id === 'number' && typeof m.texto === 'string' && m.texto.trim())
    .map((m: any) => ({ id: m.id, texto: String(m.texto) }));
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
    limpias.push({ id: p.id, nombre: p.nombre.trim(), mensajes, respuestas: respuestas.length ? respuestas : mensajes });
  }
  return limpias;
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
  return enMemoria;
}

/** Pregunta al servidor y guarda. null = no ha contestado (se deja lo de antes). */
export async function refrescarVaciles(): Promise<PestanaVaciles[] | null> {
  const res = await api.getVaciles();
  if (res === undefined) return null;
  enMemoria = limpiar(res);
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(enMemoria)); } catch {}
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
