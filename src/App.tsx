<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aplicación de Medidas Educativas</title>
    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {
            font-family: 'Inter', sans-serif;
        }
    </style>
    <!-- React & ReactDOM CDN -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <!-- Babel para transformar JSX en JavaScript estándar -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

    <!-- Script para importar Firebase de forma nativa -->
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, setDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        window.firebase = {
            initializeApp,
            getAuth,
            signInWithCustomToken,
            onAuthStateChanged,
            signInAnonymously,
            getFirestore,
            collection,
            addDoc,
            onSnapshot,
            query,
            orderBy,
            serverTimestamp,
            setDoc,
            doc
        };
    </script>
</head>
<body class="bg-gradient-to-br from-indigo-50 to-purple-50 min-h-screen">
    <div id="root"></div>

    <!-- Se cambió el tipo a "text/babel" para que Babel procese el código JSX -->
    <script type="text/babel">
        // ==========================================
        // Variables de configuración de Firebase
        // ==========================================
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        // ==========================================
        // Helpers
        // ==========================================
        const ahoraISO = () => new Date().toISOString();
        const fmtFecha = (iso) => new Date(iso).toLocaleString();
        const uuid = () =>
            typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID
                ? globalThis.crypto.randomUUID()
                : `id-${Math.random().toString(36).slice(2)}${Date.now()}`;

        const ENDPOINT = "https://script.google.com/macros/s/AKfycbx4GKOsA39sqYJolZk0NTKsx9XdsOU6Zh24In5HTmiK5WQz4YLBT4DrJ1mRndybng9T1g/exec";
        const API_KEY = "d9a66cf3-791d-451b-ac5b-656470328138";

        // ==========================================
        // Lógica pura (funciones independientes)
        // ==========================================
        function applyActivarMedida(
            estado,
            medida,
            nowISO
        ) {
            const existente = estado.medidas.find((m) => m.id === medida.id);
            if (existente && existente.activa) return estado;
            if (existente) {
                const actualizado = {
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
            const nueva = {
                id: medida.id,
                nombre: medida.nombre,
                activa: true,
                fechaInicioISO: nowISO(),
                comentarios: [],
            };
            return { ...estado, medidas: [nueva, ...estado.medidas] };
        }

        function applyToggleActiva(
            estado,
            medidaId,
            nowISO
        ) {
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

        function applyRemoveMedida(estado, medidaId) {
            return { ...estado, medidas: estado.medidas.filter((m) => m.id !== medidaId) };
        }

        function applyAddComentario(
            estado,
            medidaId,
            texto,
            nowISO,
            makeId
        ) {
            const limpio = (texto ?? "").trim();
            if (!limpio) return estado;
            const idx = estado.medidas.findIndex((m) => m.id === medidaId);
            if (idx === -1) return estado;
            const m = { ...estado.medidas[idx] };
            const nuevo = { id: makeId(), texto: limpio, fechaISO: nowISO() };
            m.comentarios = [nuevo, ...m.comentarios];
            const arr = [...estado.medidas];
            arr[idx] = m;
            return { ...estado, medidas: arr };
        }

        function filterMedidas(medidas, q) {
            const s = (q || "").trim().toLowerCase();
            if (!s) return medidas;
            return medidas.filter(
                (m) =>
                m.nombre.toLowerCase().includes(s) ||
                (!!m.descripcion && m.descripcion.toLowerCase().includes(s))
            );
        }

        function parseStrictData(data) {
            if (!data || !Array.isArray(data.medidas) || !Array.isArray(data.clases))
                throw new Error("El JSON debe tener { medidas: [], clases: [] }");
            const clasesOK = data.clases
                .map((c) => ({
                    id: String(c.id || "").trim(),
                    nombre: String(c.nombre || "").trim(),
                    alumnos: Array.isArray(c.alumnos)
                        ? c.alumnos
                            .map((a) => ({ id: String(a.id || "").trim(), nombre: String(a.nombre || "").trim() }))
                            .filter((x) => x.id && x.nombre)
                        : [],
                }))
                .filter((c) => c.id && c.nombre);
            const medidasOK = data.medidas
                .map((m) => ({
                    id: String(m.id || "").trim(),
                    nombre: String(m.nombre || "").trim(),
                    descripcion: m.descripcion ? String(m.descripcion) : undefined,
                }))
                .filter((m) => m.id && m.nombre);
            return { clases: clasesOK, medidas: medidasOK };
        }

        async function postAccion(payload) {
            const body = new URLSearchParams(payload);
            if (API_KEY) body.append("key", API_KEY);
            const r = await fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body,
            });
            if (!r.ok) throw new Error(`POST ${r.status}`);
            return r.json();
        }

        function safePost(payload) {
            if (!ENDPOINT) return Promise.resolve(undefined);
            return postAccion(payload).catch((err) => {
                console.warn("postAccion error", err);
                return undefined;
            });
        }

        // ==========================================
        // Componentes UI (React)
        // ==========================================
        function GreenDot({ title = "Activa" }) {
            return (
                <span className="inline-flex items-center" title={title}>
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse mr-2"></span>
                </span>
            );
        }

        function EmptyState({ title, subtitle, icon }) {
            return (
                <div className="flex flex-col items-center justify-center text-center p-10 border rounded-2xl border-dashed">
                    <div className="text-3xl mb-2" aria-hidden>{icon || "🔎"}</div>
                    <h3 className="font-semibold text-lg">{title}</h3>
                    {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
                </div>
            );
        }

        function Modal({ open, onClose, title, children, description, maxWidth = "max-w-3xl" }) {
            if (!open) return null;
            return ReactDOM.createPortal(
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden></div>
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
                </div>,
                document.body
            );
        }

        function SelectorMedidas({ medidas, onPick, onCancel }) {
            const [q, setQ] = React.useState("");
            const filtradas = React.useMemo(() => filterMedidas(medidas, q), [medidas, q]);
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

        function ReportMenu({ onPrint, onDownload, label = "Informe" }) {
            return (
                <div className="flex gap-2">
                    <button className="border rounded-2xl px-3 py-2 text-sm hover:bg-slate-50" onClick={onPrint}>🖨️ {label}</button>
                    <button className="border rounded-2xl px-3 py-2 text-sm hover:bg-slate-50" onClick={onDownload}>⬇️ HTML</button>
                </div>
            );
        }

        function ComentarioButton({ onSubmit }) {
            const [open, setOpen] = React.useState(false);
            const [texto, setTexto] = React.useState("");
            return (
                <>
                    <button className="border rounded-full px-2.5 py-2 text-sm hover:bg-slate-50" title="Añadir comentario" onClick={() => setOpen(true)}>💬</button>
                    <Modal open={open} onClose={() => setOpen(false)} title="Añadir comentario" description="Describe la evolución o evidencias observadas" maxWidth="max-w-lg">
                        <div className="space-y-3">
                            <textarea className="w-full min-h-[140px] border rounded-lg p-3" placeholder="Escribe aquí..." value={texto} onChange={(e) => setTexto(e.target.value)}></textarea>
                            <div className="flex justify-end gap-2">
                                <button className="px-3 py-2 text-sm" onClick={() => setOpen(false)}>Cancelar</button>
                                <button className="px-3 py-2 text-sm border rounded-lg bg-slate-900 text-white" onClick={() => { onSubmit(texto); setTexto(""); setOpen(false); }}>Guardar</button>
                            </div>
                        </div>
                    </Modal>
                </>
            );
        }

        function ConfirmDesactivarModal({ open, onClose, medidaNombre, onHistorial, onRemove }) {
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
        const REPORT_CSS = `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:22px;margin:0 0 8px 0}h2{font-size:18px;margin:24px 0 8px 0}h3{font-size:15px;margin:16px 0 6px 0}.muted{color:#64748b;font-size:12px}.card{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:8px 0;background:#fff}.alumno{border:2px solid #e2f0d9;border-radius:12px;padding:12px;margin:12px 0;background:#f9fafb}.chip{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:6px}.coment{background:#f1f5f9;border-radius:8px;padding:8px;margin:6px 0}@media print{body{padding:0}.no-print{display:none}}</style>`;

        function buildAlumnoReportHTML(
            claseNombre,
            alumnoNombre,
            estadoAlumno,
            formatDate
        ) {
            const activos = estadoAlumno.medidas.filter((m) => m.activa);
            const inactivos = estadoAlumno.medidas.filter((m) => !m.activa);
            const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            let html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe ${esc(alumnoNombre)}</title>${REPORT_CSS}</head><body>`;
            html += `<div class="no-print" style="text-align:right;margin-bottom:8px;font-size:12px;color:#64748b">Generado: ${esc(formatDate(new Date().toISOString()))}</div>`;
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

        function buildClaseReportHTML(
            claseNombre,
            alumnos,
            estadoMap,
            formatDate
        ) {
            const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            let html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe ${esc(claseNombre)}</title>${REPORT_CSS}</head><body>`;
            html += `<div class="no-print" style="text-align:right;margin-bottom:8px;font-size:12px;color:#64748b">Generado: ${esc(formatDate(new Date().toISOString()))}</div><h1>Informe de clase</h1><div class="muted">Clase: ${esc(claseNombre)}</div>`;
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

        function openPrintWindow(html) {
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
        function downloadBlob(filename, content, mime = "text/html") {
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
        function TarjetasAlumnos({
            alumnos,
            getAlumnoEstado,
            fmtFecha,
            onAddComentario,
            onToggle,
            onAñadirMedida,
            onImprimirAlumno,
            onDescargarAlumno,
        }) {
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
                                    <button className="border rounded-2xl px-2.5 py-1 text-sm bg-indigo-500 text-white hover:bg-indigo-600 transition-colors" onClick={() => onAñadirMedida(alumno.id)}>
                                        + Añadir
                                    </button>
                                </div>
                                
                                <div>
                                    <h3 className="font-medium text-sm text-slate-500 mb-2">Medidas Activas</h3>
                                    {medidasActivas.length > 0 ? (
                                        <ul className="space-y-2">
                                            {medidasActivas.map((medida) => (
                                                <li key={medida.id} className="border border-indigo-200 bg-indigo-50 rounded-lg p-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center font-medium text-sm">
                                                            <GreenDot />
                                                            {medida.nombre}
                                                        </div>
                                                        <div className="flex gap-1 items-center">
                                                            <ComentarioButton onSubmit={(texto) => onAddComentario(alumno.id, medida.id, texto)} />
                                                            <button className="border rounded-full px-2.5 py-2 text-sm hover:bg-slate-50" title="Desactivar" onClick={() => onToggle(alumno.id, medida)}>🛑</button>
                                                        </div>
                                                    </div>
                                                    {medida.comentarios.length > 0 && (
                                                        <div className="mt-2 text-sm text-gray-700 space-y-1">
                                                            {medida.comentarios.map((c) => (
                                                                <p key={c.id}>
                                                                    <span className="text-xs text-gray-400 font-semibold">{fmtFecha(c.fechaISO)}:</span> <span className="text-xs">{c.texto}</span>
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
        // Componente principal de la app
        // ==========================================
        function AppMedidas() {
            const [medidas, setMedidas] = React.useState([]);
            const [clases, setClases] = React.useState([]);
            const [loading, setLoading] = React.useState(true);
            const [error, setError] = React.useState(null);
            
            const [isAuthReady, setIsAuthReady] = React.useState(false);
            const [userId, setUserId] = React.useState(null);

            const [db, setDb] = React.useState(null);
            const [auth, setAuth] = React.useState(null);

            const [estado, setEstado] = React.useState({});

            React.useEffect(() => {
                const { initializeApp, getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously, getFirestore } = window.firebase;
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firebaseAuth = getAuth(app);
                setDb(firestoreDb);
                setAuth(firebaseAuth);

                const unsubAuth = onAuthStateChanged(firebaseAuth, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        try {
                            const signInPromise = initialAuthToken
                                ? signInWithCustomToken(firebaseAuth, initialAuthToken)
                                : signInAnonymously(firebaseAuth);
                            const userCredential = await signInPromise;
                            setUserId(userCredential.user.uid);
                        } catch (e) {
                            setError('Error de autenticación');
                            console.error(e);
                        }
                    }
                    setIsAuthReady(true);
                });

                return () => unsubAuth();
            }, []);

            React.useEffect(() => {
                if (!isAuthReady || !userId || !db) return;
                const { collection, onSnapshot, doc, setDoc } = window.firebase;
                const sharedDataCol = collection(db, "artifacts", appId, "public", "data", "medidas_por_alumno");

                const unsubscribe = onSnapshot(sharedDataCol, (snapshot) => {
                    console.log('Firestore snapshot update.');
                    setEstado(prev => {
                        let newState = { ...prev };
                        snapshot.docChanges().forEach(change => {
                            if (change.type === 'removed') {
                                delete newState[change.doc.id];
                            } else {
                                newState[change.doc.id] = change.doc.data();
                            }
                        });
                        return newState;
                    });
                }, (e) => {
                    console.error("Firestore onSnapshot error:", e);
                    setError("Error al cargar los datos en tiempo real.");
                });

                return () => unsubscribe();
            }, [isAuthReady, userId, db, appId]);

            React.useEffect(() => {
                const load = async () => {
                    setLoading(true);
                    setError(null);
                    try {
                        const url = `${ENDPOINT}${ENDPOINT.includes("?") ? "&" : "?"}action=init&key=${API_KEY}`;
                        const r = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" });
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        const data = await r.json();
                        const parsed = parseStrictData(data);
                        setClases(parsed.clases);
                        setMedidas(parsed.medidas);
                    } catch (e) {
                        setError("No se pudieron cargar los datos de alumnos y medidas. Revisa la URL del endpoint.");
                        console.error(e);
                    } finally {
                        setLoading(false);
                    }
                };
                load();
            }, []);

            const selectedClassId = React.useMemo(() => clases.length > 0 ? clases[0].id : "", [clases]);
            const clase = React.useMemo(() => clases.find((c) => c.id === selectedClassId) ?? clases[0], [clases, selectedClassId]);

            const [searchAlumno, setSearchAlumno] = React.useState("");
            const alumnosFiltrados = React.useMemo(() => {
                if (!clase) return [];
                const s = searchAlumno.trim().toLowerCase();
                return s ? clase.alumnos.filter((a) => a.nombre.toLowerCase().includes(s)) : clase.alumnos;
            }, [clase, searchAlumno]);

            const getAlumnoEstado = (id) => estado[id] ?? { alumnoId: id, medidas: [] };

            const upsertAlumnoEstado = (alumnoId, updater) => {
                if (!db) {
                    setError("Base de datos no disponible.");
                    return;
                }
                const { doc, setDoc } = window.firebase;
                const current = estado[alumnoId] ?? { alumnoId, medidas: [] };
                const next = updater(current);
                const docRef = doc(db, "artifacts", appId, "public", "data", "medidas_por_alumno", alumnoId);
                setDoc(docRef, next)
                    .then(() => {
                        safePost({ action: "save", alumno_id: alumnoId, estado_json: JSON.stringify(next) });
                    })
                    .catch((e) => {
                        setError("No se pudo guardar el cambio.");
                        console.error(e);
                    });
            };

            const activarMedida = (alumnoId, medida) =>
                upsertAlumnoEstado(alumnoId, (e) => applyActivarMedida(e, medida, ahoraISO));
            const toggleActiva = (alumnoId, medida) =>
                upsertAlumnoEstado(alumnoId, (e) => applyToggleActiva(e, medida.id, ahoraISO));
            const removeMedida = (alumnoId, medidaId) =>
                upsertAlumnoEstado(alumnoId, (e) => applyRemoveMedida(e, medidaId));
            const addComentario = (alumnoId, medidaId, texto) =>
                upsertAlumnoEstado(alumnoId, (e) => applyAddComentario(e, medidaId, texto, ahoraISO, uuid));

            const [confirm, setConfirm] = React.useState(null);
            const [showSelectorForAlumno, setShowSelectorForAlumno] = React.useState(null);

            const printAlumno = (al) => {
                const est = getAlumnoEstado(al.id);
                const html = buildAlumnoReportHTML(clase?.nombre || "", al.nombre, est, fmtFecha);
                openPrintWindow(html);
            };
            const downloadAlumno = (al) => {
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

            if (loading) {
                return (
                    <div className="min-h-screen flex items-center justify-center p-4">
                        <div className="flex flex-col items-center">
                            <svg className="animate-spin h-8 w-8 text-indigo-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="text-sm text-slate-500">Cargando datos...</p>
                        </div>
                    </div>
                );
            }

            return (
                <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 p-4 sm:p-8">
                    <div className="mx-auto max-w-7xl space-y-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-indigo-700">Medidas de intervención educativa</h1>
                                <p className="text-sm text-slate-500 mt-1">Colaboración en tiempo real para el seguimiento de alumnos.</p>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                <ReportMenu onPrint={printClase} onDownload={downloadClase} label="Informe de clase" />
                                <div className="flex items-center gap-2">
                                    <label className="text-sm text-slate-600">📘 Clase</label>
                                    <select className="border rounded-2xl px-3 py-2 text-sm bg-white" value={clases.length > 0 ? clases[0].id : ""} onChange={() => { /* Not implemented to change class */ }}>
                                        {clases.length === 0 && <option value="">(sin clases)</option>}
                                        {clases.map((c) => (
                                            <option key={c.id} value={c.id}>{c.nombre}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-xl border p-3 text-sm text-slate-700 bg-red-50 border-red-200">
                                <strong>Error:</strong> {error}
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
                            onAddComentario={(alId, mId, texto) => addComentario(alId, mId, texto)}
                            onToggle={(alId, m) => {
                                const est = getAlumnoEstado(alId);
                                const item = est.medidas.find((x) => x.id === m.id);
                                if (item?.activa) {
                                    setConfirm({ alumnoId: alId, medidaId: m.id, medidaNombre: m.nombre });
                                } else {
                                    toggleActiva(alId, m);
                                }
                            }}
                            onAñadirMedida={(alId) => setShowSelectorForAlumno(alId)}
                            onImprimirAlumno={printAlumno}
                            onDescargarAlumno={downloadAlumno}
                        />
                    </div>

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
                                    activarMedida(showSelectorForAlumno, m);
                                }
                                setShowSelectorForAlumno(null);
                            }}
                        />
                    </Modal>

                    <ConfirmDesactivarModal
                        open={!!confirm}
                        onClose={() => setConfirm(null)}
                        medidaNombre={confirm?.medidaNombre || ""}
                        onHistorial={() => {
                            if (!confirm) return;
                            toggleActiva(confirm.alumnoId, { id: confirm.medidaId });
                            setConfirm(null);
                        }}
                        onRemove={() => {
                            if (!confirm) return;
                            removeMedida(confirm.alumnoId, confirm.medidaId);
                            setConfirm(null);
                        }}
                    />
                </div>
            );
        }

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<AppMedidas />);
    </script>
</body>
</html>
