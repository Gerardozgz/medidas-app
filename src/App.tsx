import React, { useEffect, useMemo, useState } from "react";

// ==========================================
// Tipos
// ==========================================
export type Alumno = { id: string; nombre: string };
export type Clase = { id: string; nombre: string; alumnos: Alumno[] };
export type Comentario = { id: string; texto: string; fechaISO: string };
export type MedidaActiva = {
  id: string;
  nombre: string;
  activa: boolean;
  fechaInicioISO: string;
  fechaFinISO?: string;
  comentarios: Comentario[];
};
export type EstadoAlumno = { alumnoId: string; medidas: MedidaActiva[] };

// ==========================================
// Helpers
// ==========================================
const ahoraISO = () => new Date().toISOString();
const fmtFecha = (iso: string) => new Date(iso).toLocaleString();
const uuid = () =>
  typeof globalThis !== "undefined" && (globalThis as any).crypto?.randomUUID
    ? (globalThis as any).crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now()}`;

const STORAGE_KEY = "medidas_estado_v1";
const ENDPOINT_KEY = "gs_endpoint";
const INLINE_JSON_KEY = "gs_inline_json"; // pruebas locales
const APIKEY_KEY = "gs_api_key"; // clave opcional
// Defaults de autorrelleno
const DEFAULT_ENDPOINT = "";
const DEFAULT_API_KEY = "";

function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// ==========================================
// Lógica pura
// ==========================================
export function applyActivarMedida(
  estado: EstadoAlumno,
  medida: { id: string; nombre: string },
  nowISO: () => string
): EstadoAlumno {
  const existente = estado.medidas.find((m) => m.id === medida.id);
  if (existente && existente.activa) return estado;
  if (existente) {
    const actualizado: MedidaActiva = {
      ...existente,
      activa: true,
      fechaInicioISO: nowISO(),
      fechaFinISO: undefined,
    };
    return {
      ...estado,
      medidas: estado.medidas.map((m) => (m.id === medida.id ? actualizado : m)),
    };
  }
  const nueva: MedidaActiva = {
    id: medida.id,
    nombre: medida.nombre,
    activa: true,
    fechaInicioISO: nowISO(),
    comentarios: [],
  };
  return { ...estado, medidas: [nueva, ...estado.medidas] };
}

export function applyToggleActiva(
  estado: EstadoAlumno,
  medidaId: string,
  nowISO: () => string
): EstadoAlumno {
  const idx = estado.medidas.findIndex((m) => m.id === medidaId);
  if (idx === -1) return estado;
  const m = { ...estado.medidas[idx] };
  m.activa = !m.activa;
  if (m.activa) {
    m.fechaInicioISO = nowISO();
    m.fechaFinISO = undefined;
  } else {
    m.fechaFinISO = nowISO();
  }
  const arr = [...estado.medidas];
  arr[idx] = m;
  return { ...estado, medidas: arr };
}

export function applyRemoveMedida(estado: EstadoAlumno, medidaId: string): EstadoAlumno {
  return { ...estado, medidas: estado.medidas.filter((m) => m.id !== medidaId) };
}

export function applyAddComentario(
  estado: EstadoAlumno,
  medidaId: string,
  texto: string,
  nowISO: () => string,
  makeId: () => string
): EstadoAlumno {
  const limpio = (texto ?? "").trim();
  if (!limpio) return estado;
  const idx = estado.medidas.findIndex((m) => m.id === medidaId);
  if (idx === -1) return estado;
  const m = { ...estado.medidas[idx] };
  const nuevo: Comentario = { id: makeId(), texto: limpio, fechaISO: nowISO() };
  m.comentarios = [nuevo, ...m.comentarios];
  const arr = [...estado.medidas];
  arr[idx] = m;
  return { ...estado, medidas: arr };
}

export function filterMedidas(
  medidas: { id: string; nombre: string; descripcion?: string }[],
  q: string
) {
  const s = (q || "").trim().toLowerCase();
  if (!s) return medidas;
  return medidas.filter(
    (m) =>
      m.nombre.toLowerCase().includes(s) ||
      (!!m.descripcion && m.descripcion.toLowerCase().includes(s))
  );
}

// ==========================================
// Parse común
// ==========================================
function parseStrictData(data: any): { clases: Clase[]; medidas: { id: string; nombre: string; descripcion?: string }[] } {
  if (!data || !Array.isArray(data.medidas) || !Array.isArray(data.clases))
    throw new Error("El JSON debe tener { medidas: [], clases: [] }");
  const clasesOK: Clase[] = data.clases
    .map((c: any) => ({
      id: String(c.id || "").trim(),
      nombre: String(c.nombre || "").trim(),
      alumnos: Array.isArray(c.alumnos)
        ? c.alumnos
            .map((a: any) => ({ id: String(a.id || "").trim(), nombre: String(a.nombre || "").trim() }))
            .filter((x: any) => x.id && x.nombre)
        : [],
    }))
    .filter((c: Clase) => c.id && c.nombre);
  const medidasOK = data.medidas
    .map((m: any) => ({
      id: String(m.id || "").trim(),
      nombre: String(m.nombre || "").trim(),
      descripcion: m.descripcion ? String(m.descripcion) : undefined,
    }))
    .filter((m: any) => m.id && m.nombre);
  return { clases: clasesOK, medidas: medidasOK };
}

// ==========================================
// Carga/Guardado remotos (fetch + JSONP fallback para GET)
// ==========================================
function jsonpFetch(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const cb = `__GS_CB__${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let script: HTMLScriptElement | null = null;
      let timer: number | null = null;
      const cleanup = () => {
        try {
          delete (window as any)[cb];
        } catch {}
        if (script && script.parentNode) script.parentNode.removeChild(script);
        if (timer) window.clearTimeout(timer);
      };
      (window as any)[cb] = (data: any) => {
        cleanup();
        resolve(data);
      };
      const sep = url.includes("?") ? "&" : "?";
      const src = `${url}${sep}callback=${cb}`;
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP error"));
      };
      document.body.appendChild(script);
      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);
    } catch (e) {
      reject(e);
    }
  });
}

async function loadEndpointStrict(endpoint: string, key?: string): Promise<{ clases: Clase[]; medidas: { id: string; nombre: string; descripcion?: string }[] }> {
  // 1) Intento normal (fetch CORS)
  try {
    const u = key ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : endpoint;
    const r = await fetch(u, { method: "GET", mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return parseStrictData(data);
  } catch (e) {
    // 2) Fallback JSONP
    const data = await jsonpFetch(key ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : endpoint);
    return parseStrictData(data);
  }
}

// Carga del estado compartido desde Apps Script (GET con ?action=estado)
async function loadEstadoShared(endpoint: string, key?: string): Promise<Record<string, EstadoAlumno>> {
  const extra = key ? `&key=${encodeURIComponent(key)}` : "";
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}action=estado${extra}`;
  try {
    const r = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return data && data.estado ? (data.estado as Record<string, EstadoAlumno>) : {};
  } catch (e) {
    try {
      const data = await jsonpFetch(url);
      return data && data.estado ? (data.estado as Record<string, EstadoAlumno>) : {};
    } catch {
      return {};
    }
  }
}

// Envío de acciones de escritura (POST x-www-form-urlencoded para evitar preflight CORS)
async function postAccion(endpoint: string, payload: Record<string, string>, key?: string) {
  const body = new URLSearchParams(payload);
  if (key) body.append("key", key);
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!r.ok) throw new Error(`POST ${r.status}`);
  return r.json();
}

// Envoltura segura para evitar "Uncaught (in promise) TypeError: Failed to fetch" en entornos con CORS
function safePost(endpoint: string, payload: Record<string, string>, key?: string) {
  if (!endpoint) return Promise.resolve(undefined);
  return postAccion(endpoint, payload, key).catch((err) => {
    console.warn("postAccion error", err);
    return undefined;
  });
}

// ==========================================
// Componentes UI
// ==========================================
function GreenDot({ title = "Activa" }: { title?: string }) {
  return (
    <span className="inline-flex items-center" title={title}>
      <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse mr-2" />
    </span>
  );
}

function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-10 border rounded-2xl border-dashed">
      <div className="text-3xl mb-2" aria-hidden>{icon || "🔎"}</div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

function Modal({ open, onClose, title, children, description, maxWidth = "max-w-3xl" }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      {/* CLIC FUERA -> CIERRA */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className={`w-full ${maxWidth} bg-white rounded-xl shadow-xl relative`}>
          <button aria-label="Cerrar" className="absolute top-2 right-2 rounded-full w-8 h-8 hover:bg-slate-100" onClick={onClose}>✕</button>
          <div className="p-4 border-b">
            <h3 className="font-semibold">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SelectorMedidas({ medidas, onPick, onCancel }: {
  medidas: { id: string; nombre: string; descripcion?: string }[];
  onPick: (m: { id: string; nombre: string }) => void;
  onCancel?: () => void;
}) {
  const [q, setQ] = useState("");
  const filtradas = useMemo(() => filterMedidas(medidas, q), [medidas, q]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">🔍</span>
        <input className="flex-1 border rounded-lg px-3 py-2" placeholder="Buscar medida..." value={q} onChange={(e) => setQ(e.target.value)} />
        {onCancel && (
          <button className="px-3 py-2 text-sm" onClick={onCancel}>Salir</button>
        )}
      </div>
      <div className="h-[50vh] overflow-auto pr-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtradas.map((m) => (
            <div key={m.id} className="cursor-pointer hover:shadow-md transition border rounded-xl p-3" onClick={() => onPick(m)}>
              <div className="font-medium flex items-center gap-2">
                <span>📝</span>
                <span>{m.nombre}</span>
              </div>
              {m.descripcion && <div className="text-sm text-muted-foreground mt-1">{m.descripcion}</div>}
            </div>
          ))}
          {filtradas.length === 0 && (
            <div className="col-span-full">
              <EmptyState title="Sin resultados" subtitle="Ajusta tu búsqueda" icon="⚙️" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportMenu({ onPrint, onDownload, label = "Informe" }: { onPrint: () => void; onDownload: () => void; label?: string }) {
  return (
    <div className="flex gap-2">
      <button className="border rounded-2xl px-3 py-2 text-sm hover:bg-slate-50" onClick={onPrint}>🖨️ {label}</button>
      <button className="border rounded-2xl px-3 py-2 text-sm hover:bg-slate-50" onClick={onDownload}>⬇️ HTML</button>
    </div>
  );
}

function ComentarioButton({ onSubmit }: { onSubmit: (texto: string) => void }) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  return (
    <>
      <button className="border rounded-full px-2.5 py-2 text-sm hover:bg-slate-50" title="Añadir comentario" onClick={() => setOpen(true)}>💬</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Añadir comentario" description="Describe la evolución o evidencias observadas" maxWidth="max-w-lg">
        <div className="space-y-3">
          <textarea className="w-full min-h-[140px] border rounded-lg p-3" placeholder="Escribe aquí..." value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="px-3 py-2 text-sm" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="px-3 py-2 text-sm border rounded-lg bg-slate-900 text-white" onClick={() => { onSubmit(texto); setTexto(""); setOpen(false); }}>Guardar</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ConfirmDesactivarModal({ open, onClose, medidaNombre, onHistorial, onRemove }: {
  open: boolean;
  onClose: () => void;
  medidaNombre: string;
  onHistorial: () => void; // desactivar y pasar a historial
  onRemove: () => void;    // no guardar
}) {
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="¿Qué deseas hacer?"
      description={`Con la medida "${medidaNombre}" puedes guardarla en historial o eliminarla sin dejar rastro.`}
      maxWidth="max-w-lg"
    >
      <div className="flex flex-col sm:flex-row gap-2 justify-end">
        <button className="px-3 py-2 text-sm" onClick={onClose}>Cancelar</button>
        <button className="px-3 py-2 text-sm border rounded-lg" onClick={onRemove}>No guardar</button>
        <button className="px-3 py-2 text-sm border rounded-lg bg-slate-900 text-white" onClick={onHistorial}>Guardar en historial</button>
      </div>
    </Modal>
  );
}

// ==========================================
// Informes (HTML)
// ==========================================
const REPORT_CSS = `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:22px;margin:0 0 8px 0}h2{font-size:18px;margin:24px 0 8px 0}h3{font-size:15px;margin:16px 0 6px 0}.muted{color:#64748b;font-size:12px}.card{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:8px 0;background:#fff}.alumno{border:2px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0;background:#fff}.chip{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:6px}.coment{background:#f1f5f9;border-radius:8px;padding:8px;margin:6px 0}@media print{body{padding:0}.no-print{display:none}}</style>`;

export function buildAlumnoReportHTML(
  claseNombre: string,
  alumnoNombre: string,
  estadoAlumno: EstadoAlumno,
  formatDate: (iso: string) => string
): string {
  const activos = estadoAlumno.medidas.filter((m) => m.activa);
  const inactivos = estadoAlumno.medidas.filter((m) => !m.activa);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe ${esc(alumnoNombre)}</title>${REPORT_CSS}</head><body>`;
  html += `<div class="no-print" style="text-align:right;margin-bottom:8px;font-size:12px;color:#64748b">Generado: ${formatDate(new Date().toISOString())}</div>`;
  html += `<h1>Informe de medidas</h1><div class="muted">Clase: ${esc(claseNombre)} &nbsp;&nbsp; Alumno: ${esc(alumnoNombre)}</div>`;
  html += `<h2>Medidas activas</h2>` + (activos.length ? activos.map((m) => {
    let b = `<div class="card"><h3>${esc(m.nombre)} <span class="chip">Activa</span></h3><div class="muted">Desde ${esc(formatDate(m.fechaInicioISO))}</div>`;
    if (m.comentarios.length) {
      b += `<div style="margin-top:6px"><div class="muted">Comentarios</div>` + m.comentarios.map((c) => `<div class="coment"><div class="muted">${esc(formatDate(c.fechaISO))}</div><div>${esc(c.texto)}</div></div>`).join("") + `</div>`;
    }
    return b + `</div>`;
  }).join("") : `<div class="card">Sin medidas activas</div>`);
  html += `<h2>Historial</h2>` + (inactivos.length ? inactivos.map((m) => {
    let b = `<div class="card"><h3>${esc(m.nombre)} <span class="chip">Inactiva</span></h3><div class="muted">${m.fechaInicioISO ? esc(formatDate(m.fechaInicioISO)) : ""}${m.fechaFinISO ? " - " + esc(formatDate(m.fechaFinISO)) : ""}</div>`;
    if (m.comentarios.length) {
      b += `<div style="margin-top:6px"><div class="muted">Comentarios</div>` + m.comentarios.map((c) => `<div class="coment"><div class="muted">${esc(formatDate(c.fechaISO))}</div><div>${esc(c.texto)}</div></div>`).join("") + `</div>`;
    }
    return b + `</div>`;
  }).join("") : `<div class="card">Sin historial</div>`);
  return html + `</body></html>`;
}

export function buildClaseReportHTML(
  claseNombre: string,
  alumnos: { id: string; nombre: string }[],
  estadoMap: Record<string, EstadoAlumno>,
  formatDate: (iso: string) => string
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe ${esc(claseNombre)}</title>${REPORT_CSS}</head><body>`;
  html += `<div class="no-print" style="text-align:right;margin-bottom:8px;font-size:12px;color:#64748b">Generado: ${formatDate(new Date().toISOString())}</div><h1>Informe de clase</h1><div class="muted">Clase: ${esc(claseNombre)}</div>`;
  for (const al of alumnos) {
    const est = estadoMap[al.id] ?? { alumnoId: al.id, medidas: [] };
    html += `<div class="alumno"><h2>${esc(al.nombre)}</h2>`;
    const activos = est.medidas.filter((m) => m.activa);
    const inactivos = est.medidas.filter((m) => !m.activa);
    html += `<h3>Medidas activas</h3>` + (activos.length ? activos.map((m) => {
      let b = `<div class="card"><strong>${esc(m.nombre)}</strong> <span class="chip">Activa</span><div class="muted">Desde ${esc(formatDate(m.fechaInicioISO))}</div>`;
      if (m.comentarios.length) { b += m.comentarios.map((c) => `<div class="coment"><div class="muted">${esc(formatDate(c.fechaISO))}</div><div>${esc(c.texto)}</div></div>`).join(""); }
      return b + `</div>`;
    }).join("") : `<div class="card">Sin medidas activas</div>`);
    html += `<h3>Historial</h3>` + (inactivos.length ? inactivos.map((m) => {
      let b = `<div class="card"><strong>${esc(m.nombre)}</strong> <span class="chip">Inactiva</span><div class="muted">${m.fechaInicioISO ? esc(formatDate(m.fechaInicioISO)) : ""}${m.fechaFinISO ? " - " + esc(formatDate(m.fechaFinISO)) : ""}</div>`;
      if (m.comentarios.length) { b += m.comentarios.map((c) => `<div class="coment"><div class="muted">${esc(formatDate(c.fechaISO))}</div><div>${esc(c.texto)}</div></div>`).join(""); }
      return b + `</div>`;
    }).join("") : `<div class="card">Sin historial</div>`);
    html += `</div>`;
  }
  return html + `</body></html>`;
}

function openPrintWindow(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {}
  }, 250);
}
function downloadBlob(filename: string, content: string, mime = "text/html") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ==========================================
// Componente TarjetasAlumnos
// ==========================================
interface TarjetasAlumnosProps {
  alumnos: Alumno[];
  getAlumnoEstado: (id: string) => EstadoAlumno;
  fmtFecha: (iso: string) => string;
  onAddComentario: (alId: string, mId: string, texto: string) => void;
  onToggle: (alId: string, m: { id: string; nombre: string }) => void;
  onAñadirMedida: (alId: string) => void;
  onImprimirAlumno: (al: Alumno) => void;
  onDescargarAlumno: (al: Alumno) => void;
}

function TarjetasAlumnos({
  alumnos,
  getAlumnoEstado,
  fmtFecha,
  onAddComentario,
  onToggle,
  onAñadirMedida,
  onImprimirAlumno,
  onDescargarAlumno,
}: TarjetasAlumnosProps) {
  if (alumnos.length === 0) {
    return (
      <EmptyState
        title="Sin alumnos para mostrar"
        subtitle="Ajusta la búsqueda o revisa la fuente de datos"
        icon="🧑‍🎓"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {alumnos.map((alumno) => {
        const estado = getAlumnoEstado(alumno.id);
        const medidasActivas = estado.medidas.filter((m) => m.activa);
        const medidasHistorial = estado.medidas.filter((m) => !m.activa);

        return (
          <div key={alumno.id} className="bg-white border rounded-xl p-4 shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{alumno.nombre}</h2>
              <button className="border rounded-2xl px-2.5 py-1 text-sm hover:bg-slate-50" onClick={() => onAñadirMedida(alumno.id)}>
                + Añadir
              </button>
            </div>
            
            <div>
              <h3 className="font-medium text-sm text-slate-500 mb-2">Medidas Activas</h3>
              {medidasActivas.length > 0 ? (
                <ul className="space-y-2">
                  {medidasActivas.map((medida) => (
                    <li key={medida.id} className="border rounded-lg p-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center font-medium">
                          <GreenDot />
                          {medida.nombre}
                        </div>
                        <div className="flex gap-1 items-center">
                          <ComentarioButton onSubmit={(texto) => onAddComentario(alumno.id, medida.id, texto)} />
                          <button className="border rounded-full px-2.5 py-2 text-sm hover:bg-slate-50" title="Desactivar" onClick={() => onToggle(alumno.id, medida)}>🛑</button>
                        </div>
                    </div>
                    {medida.comentarios.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500 space-y-1">
                        {medida.comentarios.map((c) => (
                          <p key={c.id}>
                            <span className="font-semibold">{fmtFecha(c.fechaISO)}:</span> {c.texto}
                          </p>
                        ))}
                    </div>
                  )}
                  </li>
                ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Sin medidas activas</p>
              )}
            </div>

            <div>
              <h3 className="font-medium text-sm text-slate-500 mb-2">Historial</h3>
              {medidasHistorial.length > 0 ? (
                <ul className="space-y-2">
                  {medidasHistorial.map((medida) => (
                    <li key={medida.id} className="border rounded-lg p-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center font-medium">
                          {medida.nombre}
                        </div>
                        <div className="flex gap-1 items-center">
                          <button className="border rounded-full px-2.5 py-2 text-sm hover:bg-slate-50" title="Reactivar" onClick={() => onToggle(alumno.id, medida)}>🔄</button>
                        </div>
                    </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Sin historial de medidas</p>
              )}
            </div>
            
            <div className="flex gap-2 justify-end">
              <ReportMenu onPrint={() => onImprimirAlumno(alumno)} onDownload={() => onDescargarAlumno(alumno)} label="Informe" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// Componente FuenteDatos
// ==========================================
function FuenteDatos({ show, endpoint, setEndpoint, apiKey, setApiKey, inlineJSON, setInlineJSON, endpointError }:{
  show: boolean;
  endpoint: string; setEndpoint: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  inlineJSON: string; setInlineJSON: (v: string) => void;
  endpointError: string;
}) {
  if (!show) return null;
  return (
    <div className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Fuente de datos (Google Apps Script)</h3>
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="URL del endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Clave API (opcional)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        {endpointError && <p className="text-sm text-red-500">{endpointError}</p>}
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Pegar JSON de prueba (modo local)</h3>
        <textarea className="w-full min-h-[140px] border rounded-lg p-3 text-sm" placeholder="Pega tu JSON aquí..." value={inlineJSON} onChange={(e) => setInlineJSON(e.target.value)} />
      </div>
    </div>
  );
}

// ==========================================
// App (endpoint + opción de pegado para prueba local)
// ==========================================
export default function AppMedidas() {
  const [medidas, setMedidas] = useState<{ id: string; nombre: string; descripcion?: string }[]>([]);
  const [clases, setClases] = useState<Clase[]>([]);
  const [endpointError, setEndpointError] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>(() => {
    try {
      return localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
    } catch {
      return DEFAULT_ENDPOINT;
    }
  });
  const [inlineJSON, setInlineJSON] = usePersistedState<string>(INLINE_JSON_KEY, "");
  const [apiKey, setApiKey] = usePersistedState<string>(APIKEY_KEY, DEFAULT_API_KEY);
  const [usandoPegado, setUsandoPegado] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const clase = useMemo(() => clases.find((c) => c.id === selectedClassId) ?? clases[0], [clases, selectedClassId]);
  useEffect(() => {
    if (clases.length)
      setSelectedClassId((prev) => (clases.some((c) => c.id === prev) ? prev : clases[0].id));
  }, [clases]);

  const [searchAlumno, setSearchAlumno] = useState("");
  const alumnosFiltrados = useMemo(() => {
    if (!clase) return [] as Alumno[];
    const s = searchAlumno.trim().toLowerCase();
    return s ? clase.alumnos.filter((a) => a.nombre.toLowerCase().includes(s)) : clase.alumnos;
  }, [clase, searchAlumno]);

  const [estado, setEstado] = usePersistedState<Record<string, EstadoAlumno>>(STORAGE_KEY, {});
  const getAlumnoEstado = (id: string) => estado[id] ?? { alumnoId: id, medidas: [] };
  const upsertAlumnoEstado = (alumnoId: string, updater: (e: EstadoAlumno) => EstadoAlumno) =>
    setEstado((prev) => {
      const curr = prev[alumnoId] ?? { alumnoId, medidas: [] };
      const next = updater(curr);
      return { ...prev, [alumnoId]: next };
    });

  const activarMedida = (alumnoId: string, medida: { id: string; nombre: string }) =>
    upsertAlumnoEstado(alumnoId, (e) => applyActivarMedida(e, medida, ahoraISO));
  const toggleActiva = (alumnoId: string, medidaId: string) =>
    upsertAlumnoEstado(alumnoId, (e) => applyToggleActiva(e, medidaId, ahoraISO));
  const removeMedida = (alumnoId: string, medidaId: string) =>
    upsertAlumnoEstado(alumnoId, (e) => applyRemoveMedida(e, medidaId));
  const addComentario = (alumnoId: string, medidaId: string, texto: string) =>
    upsertAlumnoEstado(alumnoId, (e) => applyAddComentario(e, medidaId, texto, ahoraISO, uuid));

  // Confirmación de desactivación
  const [confirm, setConfirm] = useState<null | { alumnoId: string; medidaId: string; medidaNombre: string }>(null);

  // UI: fuente de datos y selector
  const [showFuente, setShowFuente] = useState(false);
  const [showSelectorForAlumno, setShowSelectorForAlumno] = useState<string | null>(null);

  // ----- Carga de datos: fetch -> JSONP -> pegado manual -----
  useEffect(() => {
    const load = async () => {
      setUsandoPegado(false);
      try {
        if (!endpoint && !inlineJSON) {
          setEndpointError("Configura el endpoint o pega un JSON de prueba");
          setClases([]);
          setMedidas([]);
          return;
        }
        if (endpoint) {
          const parsed = await loadEndpointStrict(endpoint, apiKey);
          setClases(parsed.clases);
          setMedidas(parsed.medidas);
          // cargar estado compartido (si existe)
          try {
            const shared = await loadEstadoShared(endpoint, apiKey);
            if (shared && Object.keys(shared).length) setEstado(shared);
          } catch {}
          setEndpointError("");
          return;
        }
      } catch (e: any) {
        setEndpointError(e?.message || "No se pudieron cargar datos del endpoint");
      }
      // Fallback: pegado manual
      try {
        if (inlineJSON) {
          const data = JSON.parse(inlineJSON);
          const parsed = parseStrictData(data);
          setClases(parsed.clases);
          setMedidas(parsed.medidas);
          setUsandoPegado(true);
          setEndpointError("");
          return;
        }
      } catch (e: any) {
        setEndpointError("JSON pegado inválido");
        setClases([]);
        setMedidas([]);
      }
    };
    load();
  }, [endpoint, inlineJSON, apiKey, setEstado]);

  useEffect(() => {
    try {
      localStorage.setItem(ENDPOINT_KEY, endpoint);
    } catch {}
  }, [endpoint]);

  // Informes
  const printAlumno = (al: { id: string; nombre: string }) => {
    const est = getAlumnoEstado(al.id);
    const html = buildAlumnoReportHTML(clase?.nombre || "", al.nombre, est, fmtFecha);
    openPrintWindow(html);
  };
  const downloadAlumno = (al: { id: string; nombre: string }) => {
    const est = getAlumnoEstado(al.id);
    const html = buildAlumnoReportHTML(clase?.nombre || "", al.nombre, est, fmtFecha);
    downloadBlob(`informe-${al.nombre.replace(/\s+/g, "_")}.html`, html);
  };
  const printClase = () => {
    if (!clase) return;
    const html = buildClaseReportHTML(clase.nombre, clase.alumnos, estado, fmtFecha);
    openPrintWindow(html);
  };
  const downloadClase = () => {
    if (!clase) return;
    const html = buildClaseReportHTML(clase.nombre, clase.alumnos, estado, fmtFecha);
    downloadBlob(`informe-clase-${clase.nombre.replace(/\s+/g, "_")}.html`, html);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Top bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Medidas de intervención educativa</h1>
            <p className="text-sm text-muted-foreground mt-1">Selecciona una clase, añade medidas a cada alumno y registra comentarios de seguimiento.</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <ReportMenu onPrint={printClase} onDownload={downloadClase} label="Informe de clase" />
            <button className="border rounded-2xl px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setShowFuente((v) => !v)}>⚙️ Fuente de datos</button>
            <div className="flex items-center gap-2">
              <label className="text-sm">📘 Clase</label>
              <select className="border rounded-2xl px-3 py-2 text-sm" value={clase?.id || ""} onChange={(e) => setSelectedClassId(e.target.value)}>
                {clases.length === 0 && <option value="">(sin clases)</option>}
                {clases.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              {usandoPegado && (
                <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-1" title="Mostrando datos pegados en local">Fuente: JSON pegado</span>
              )}
            </div>
          </div>
        </div>

        {/* Panel fuente de datos */}
        <FuenteDatos
          show={showFuente}
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          apiKey={apiKey}
          setApiKey={setApiKey}
          inlineJSON={inlineJSON}
          setInlineJSON={setInlineJSON}
          endpointError={endpointError}
        />

        {endpoint && !endpointError && clases.length === 0 && (
          <div className="rounded-xl border p-3 text-sm text-slate-700 bg-amber-50 border-amber-200">
            No hay clases para mostrar. Revisa que el endpoint devuelva <code>{`{ clases: [...] }`}</code> o usa el pegado manual.
          </div>
        )}

        {!endpoint && !inlineJSON && (
          <div className="rounded-xl border p-3 text-sm text-slate-700 bg-slate-50">
            Configura el endpoint o pega un JSON en <strong>⚙️ Fuente de datos</strong>.
          </div>
        )}

        <div className="relative w-full sm:w-96">
          <input className="w-full border rounded-lg pl-9 pr-3 py-2" placeholder="Buscar alumno por nombre..." value={searchAlumno} onChange={(e) => setSearchAlumno(e.target.value)} />
          <span className="absolute left-3 top-1/2 -translate-y-1/2" aria-hidden>🔎</span>
        </div>

        <TarjetasAlumnos
          alumnos={alumnosFiltrados}
          getAlumnoEstado={getAlumnoEstado}
          fmtFecha={fmtFecha}
          onAddComentario={(alId, mId, texto) => { safePost(endpoint, { action: "comentar", alumno_id: alId, medida_id: mId, texto }, apiKey); addComentario(alId, mId, texto); }}
          onToggle={(alId, m) => {
            // Si está activa -> preguntar
            const est = getAlumnoEstado(alId);
            const item = est.medidas.find((x) => x.id === m.id);
            if (item?.activa) {
              setConfirm({ alumnoId: alId, medidaId: m.id, medidaNombre: m.nombre });
            } else {
              // inactiva -> reactivar sin preguntar
              safePost(endpoint, { action: "toggle", alumno_id: alId, medida_id: m.id }, apiKey);
              toggleActiva(alId, m.id);
            }
          }}
          onAñadirMedida={(alId) => setShowSelectorForAlumno(alId)}
          onImprimirAlumno={printAlumno}
          onDescargarAlumno={downloadAlumno}
        />
      </div>

      {/* Modal de selección de medidas (clic fuera cierra) */}
      <Modal
        open={!!showSelectorForAlumno}
        onClose={() => setShowSelectorForAlumno(null)}
        title="Selecciona una medida"
        description={showSelectorForAlumno ? `Se activará para el alumno seleccionado.` : undefined}
      >
        <SelectorMedidas
          medidas={medidas}
          onCancel={() => setShowSelectorForAlumno(null)}
          onPick={(m) => {
            if (showSelectorForAlumno) {
              const alumnoId = showSelectorForAlumno;
              safePost(endpoint, { action: "activar", alumno_id: alumnoId, medida_id: m.id, medida_nombre: m.nombre }, apiKey);
              activarMedida(alumnoId, m);
            }
            setShowSelectorForAlumno(null);
          }}
        />
      </Modal>

      {/* Modal confirmar desactivación */}
      <ConfirmDesactivarModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        medidaNombre={confirm?.medidaNombre || ""}
        onHistorial={() => {
          if (!confirm) return;
          safePost(endpoint, { action: "toggle", alumno_id: confirm.alumnoId, medida_id: confirm.medidaId }, apiKey);
          toggleActiva(confirm.alumnoId, confirm.medidaId);
          setConfirm(null);
        }}
        onRemove={() => {
          if (!confirm) return;
          safePost(endpoint, { action: "remove", alumno_id: confirm.alumnoId, medida_id: confirm.medidaId }, apiKey);
          removeMedida(confirm.alumnoId, confirm.medidaId);
          setConfirm(null);
        }}
      />
    </div>
  );
}
