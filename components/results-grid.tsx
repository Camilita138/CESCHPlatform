// components/results-grid.tsx
"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExternalLink, Download, Eye, Grid, List, Loader2, Trash2, Tag, Sheet as SheetIcon, CheckCircle2 } from "lucide-react";

// Tipos
export type Item = {
  id: string;
  url: string;
  name: string;
  b64?: string;
  // visibles en tarjeta
  hsCode: string;
  commercialName: string;
  confidence: number | null;
  reason: string;
  // campos proforma/liquidación:
  proveedores?: string;
  modelo?: string;
  link_de_la_imagen?: string;
  descripcion?: string;
  nombre_comercial?: string;
  unidad_de_medida?: string;
  cantidad_x_caja?: number | null;
  cajas?: number | null;
  total_unidades?: number | null;
  precio_unitario_usd?: number | null;
  total_usd?: number | null;
  partida?: string;
};

interface ResultsGridProps {
  /** PREP payload: { documentName, folderUrl, items: [...] } */
  data: any;
  onChangeItems?: (items: Item[]) => void;
}

const inputAlwaysVisible =
  "h-11 bg-white border border-muted-foreground/40 shadow-sm " +
  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 " +
  "placeholder:text-muted-foreground";

export function ResultsGrid({ data, onChangeItems }: ResultsGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [tab, setTab] = useState<"imagenes" | "proforma">("imagenes");
  const [publishing, setPublishing] = useState(false);
  const [publishOk, setPublishOk] = useState<{sheetUrl: string; total: number} | null>(null);
  const [templateKey, setTemplateKey] = useState<"aereo" | "maritimo" | "contenedor">("aereo");

  const documentName: string = data?.documentName || "Liquidación";
  const folderUrl: string = data?.folderUrl || "";

  // Normaliza los ITEMS devueltos por el PREP
  // en components/results-grid.tsx
  // ✅ Reemplaza tu bloque actual de useMemo por este

  // ✅ Reemplazo completo
  // ✅ BLOQUE REEMPLAZADO
  const initialRows: Item[] = useMemo(() => {
    // 🔹 Usa únicamente data.items, no data.images
    const raw: any[] = Array.isArray(data?.items) ? data.items : [];

    return raw.map((r, idx) => {
      const id = r.id || `item_${idx + 1}`;
      const url = r.url || (r.b64 ? `data:image/png;base64,${r.b64}` : "/placeholder.svg");
      const hsRaw = r.hsCode || r.hs_code || r.partida || "";
      const hs6 = hsRaw ? String(hsRaw).replace(/\D/g, "").slice(0, 6) : "";

      return {
        id,
        url,
        name: r.name || `item_${String(idx + 1).padStart(3, "0")}`,
        b64: r.b64 || "",
        hsCode: hs6,
        commercialName: (r.nombre_comercial || r.commercialName || "").toString().toUpperCase(),
        confidence: r.confidence ?? null,
        reason: r.reason || "",

        // 🔹 Campos Proforma
        nombre_comercial: (r.nombre_comercial || "").toString().toUpperCase(),
        descripcion: r.descripcion || "Sin descripción",
        modelo: r.modelo || "",
        unidad_de_medida: r.unidad_de_medida || "PZA",
        cantidad_x_caja: r.cantidad_x_caja ?? null,
        cajas: r.cajas ?? null,
        total_unidades: r.total_unidades ?? null,
        precio_unitario_usd: r.precio_unitario_usd ?? null,
        total_usd: r.total_usd ?? null,
        partida: hs6,
        proveedores: r.proveedores ?? "",
        link_de_la_imagen: r.link_de_la_imagen ?? "",
      };
    });
  }, [data?.items]);


  const [rows, setRows] = useState<Item[]>(() => initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);

  const applyUpdate = (id: string, patch: Partial<Item>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleDelete = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      onChangeItems?.(next);
      return next;
    });
  };

  const total = rows.length;

  // COMMIT → Google Sheets
  async function publishToSheets() {
    if (!folderUrl) {
      alert("Falta la URL/ID de Carpeta de Google Drive (folderUrl).");
      return;
    }
    if (rows.length === 0) {
      alert("No hay ítems para publicar.");
      return;
    }

    setPublishing(true);
    setPublishOk(null);
    try {
      const items = rows.map((r) => ({
        name: r.name,
        url: r.url,
        b64: r.b64, // opcional
        // IA
        hsCode: (r.hsCode || "").replace(/\D/g, "").slice(0, 10),
        commercialName: r.commercialName || r.nombre_comercial || "",
        confidence: r.confidence ?? 0,
        reason: r.reason || "",
        // proforma/liquidación
        proveedores: r.proveedores ?? "",
        modelo: r.modelo ?? "",
        link_de_la_imagen: r.link_de_la_imagen ?? "",
        descripcion: r.descripcion ?? "",
        nombre_comercial: r.nombre_comercial ?? r.commercialName ?? "",
        unidad_de_medida: r.unidad_de_medida ?? "PZA",
        cantidad_x_caja: r.cantidad_x_caja ?? null,
        cajas: r.cajas ?? null,
        total_unidades: r.total_unidades ?? null,
        precio_unitario_usd: r.precio_unitario_usd ?? null,
        total_usd: r.total_usd ?? null,
        partida: (r.partida || r.hsCode || "").toString().replace(/\D/g, "").slice(0, 10),
      }));

      const resp = await fetch("/api/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          documentName,
          folderUrl,
          items,
          templateKey, // aéreo / marítimo / contenedor
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${resp.status}`);
      }

      const out = await resp.json();
      setPublishOk({ sheetUrl: out.sheetUrl, total: items.length });
    } catch (e: any) {
      alert(`Error al publicar: ${e?.message || e}`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Revisión / edición antes de crear la hoja</h1>
          <p className="text-muted-foreground">
            Corrige datos de la proforma o reclasifica productos. Luego publica a Google Sheets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Selector de plantilla */}
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value as any)}
            className="border rounded-md px-2 py-1 text-sm"
          >
            <option value="maritimo">Plantilla Marítimo</option>
            <option value="aereo">Plantilla Aéreo</option>
            <option value="contenedor">Plantilla Contenedor</option>
          </select>

          <Button onClick={publishToSheets} disabled={publishing || total === 0} className="gap-2">
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Publicando…
              </>
            ) : (
              <>
                <SheetIcon className="h-4 w-4" />
                Publicar a Google Sheets
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Aviso de éxito */}
      {publishOk ? (
        <Card className="border-green-600/30">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-medium">¡Publicado! {publishOk.total} filas creadas.</p>
                <p className="text-sm text-muted-foreground">Tu hoja está lista para revisar y compartir.</p>
              </div>
            </div>
            <Button asChild variant="outline" className="gap-2">
              <a href={publishOk.sheetUrl} target="_blank" rel="noopener noreferrer">
                Abrir Sheet <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <Button variant={tab === "imagenes" ? "default" : "outline"} onClick={() => setTab("imagenes")}>
          Imágenes
        </Button>
        <Button
          variant={tab === "proforma" ? "default" : "outline"}
          onClick={() => setTab("proforma")}
          
        >
          Proforma (tabla editable)
        </Button>


        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("grid")}
            aria-label="Ver como grilla"
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("list")}
            aria-label="Ver como lista"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Contenido de las tabs */}
      {tab === "imagenes" ? (
        <ImagenesTab
          rows={rows}
          onApply={(id, patch) => applyUpdate(id, patch)}
          onDelete={(id) => handleDelete(id)}
          viewMode={viewMode}
          publishing={publishing}
        />
      ) : (
        <ProformaTab rows={rows} onApply={(id, patch) => applyUpdate(id, patch)} />
      )}
    </div>
  );
}

/* =================== Tab: Imágenes =================== */
function ImagenesTab({
  rows,
  onApply,
  onDelete,
  viewMode,
  publishing,
}: {
  rows: Item[];
  onApply: (id: string, patch: Partial<Item>) => void;
  onDelete: (id: string) => void;
  viewMode: "grid" | "list";
  publishing: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Imágenes / items detectados</CardTitle>
        <CardDescription>Edita el nombre comercial para mejorar la partida.</CardDescription>
      </CardHeader>
      <CardContent>
        {publishing && (
          <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-lg p-6 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-medium">Publicando a Google Sheets…</span>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay imágenes.</p>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
            {rows.map((item) => (
              <ImageCard
                key={item.id}
                item={item}
                onApply={(p) => onApply(item.id, p)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((item) => (
              <ImageRow
                key={item.id}
                item={item}
                onApply={(p) => onApply(item.id, p)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =================== Tab: Proforma (tabla) =================== */
function ProformaTab({
  rows,
  onApply,
}: {
  rows: Item[];
  onApply: (id: string, patch: Partial<Item>) => void;
}) {
  const headers = [
    "#",
    "NOMBRE COMERCIAL",
    "DESCRIPCION",
    "MODELO",
    "UNIDAD DE MEDIDA",
    "CANTIDAD x CAJA",
    "CAJAS",
    "TOTAL UNIDADES",
    "PARTIDA",
    "PRECIO UNITARIO USD",
    "TOTAL USD",
    "LINK DE LA IMAGEN",
    "PROVEEDORES",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proforma (datos editables)</CardTitle>
        <CardDescription>Corrige antes de publicar. Los nombres de columnas coinciden con tu liquidación.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 sticky top-0 z-10">
                <tr className="[&>th]:font-medium [&>th]:whitespace-nowrap">
                  {headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left border-b border-neutral-200 dark:border-neutral-800">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2">{i + 1}</td>

                    {/* NOMBRE COMERCIAL */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.nombre_comercial ?? r.commercialName ?? ""}
                        onChange={(e) => onApply(r.id, { nombre_comercial: e.target.value, commercialName: e.target.value })}
                      />
                    </td>

                    {/* DESCRIPCION */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.descripcion ?? ""}
                        onChange={(e) => onApply(r.id, { descripcion: e.target.value })}
                      />
                    </td>

                    {/* MODELO */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.modelo ?? ""}
                        onChange={(e) => onApply(r.id, { modelo: e.target.value })}
                      />
                    </td>

                    {/* UNIDAD DE MEDIDA */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.unidad_de_medida ?? "PZA"}
                        onChange={(e) => onApply(r.id, { unidad_de_medida: e.target.value })}
                      />
                    </td>

                    {/* CANT x CAJA */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        inputMode="decimal"
                        value={r.cantidad_x_caja ?? ""}
                        onChange={(e) => onApply(r.id, { cantidad_x_caja: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>

                    {/* CAJAS */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        inputMode="decimal"
                        value={r.cajas ?? ""}
                        onChange={(e) => onApply(r.id, { cajas: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>

                    {/* TOTAL UNIDADES */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        inputMode="decimal"
                        value={r.total_unidades ?? ""}
                        onChange={(e) => onApply(r.id, { total_unidades: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>

                    {/* PARTIDA */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        value={r.partida ?? r.hsCode ?? ""}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, "").slice(0, 10);
                          onApply(r.id, { partida: clean, hsCode: clean });
                        }}
                      />
                    </td>

                    {/* PRECIO UNITARIO USD */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        inputMode="decimal"
                        value={r.precio_unitario_usd ?? ""}
                        onChange={(e) => onApply(r.id, { precio_unitario_usd: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>

                    {/* TOTAL USD */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border text-right"
                        inputMode="decimal"
                        value={r.total_usd ?? ""}
                        onChange={(e) => onApply(r.id, { total_usd: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>

                    {/* LINK IMAGEN */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.link_de_la_imagen ?? ""}
                        onChange={(e) => onApply(r.id, { link_de_la_imagen: e.target.value })}
                      />
                    </td>

                    {/* PROVEEDORES */}
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded-md px-2 py-1.5 border"
                        value={r.proveedores ?? ""}
                        onChange={(e) => onApply(r.id, { proveedores: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================= Tarjeta y Fila (misma lógica) ================= */
function ImageCard({
  item, onApply, onDelete,
}: { item: Item; onApply: (patch: Partial<Item>) => void; onDelete: () => void; }) {
  const [name, setName] = useState(item.commercialName || "");
  const [hs, setHs] = useState(item.hsCode || "");
  const [conf] = useState<number | null>(item.confidence ?? null);
  const [reason] = useState(item.reason || "");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);
  const lastSentRef = useRef<string>(item.commercialName || "");

  useEffect(() => {
    setName(item.commercialName || "");
    setHs(item.hsCode || "");
    lastSentRef.current = item.commercialName || "";
  }, [item.id]);

  const doReclass = async (forcedName?: string) => {
    const nameToUse = (forcedName ?? name ?? "").trim();
    if (!nameToUse && !item.url) return;
    if (nameToUse === lastSentRef.current && !!hs) return;

    setLoading(true);
    try {
      const res = await fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: item.url, commercialName: nameToUse || undefined }),
      });
      if (res.ok) {
        const payload = await res.json();
        const nextHs = (payload.hsCode || "").replace(/\D/g, "").slice(0, 6);
        const nextName = payload.commercialName || nameToUse;
        onApply({ hsCode: nextHs, commercialName: nextName, nombre_comercial: nextName, reason: payload.reason || "" });
        lastSentRef.current = nameToUse;
        setHs(nextHs);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const onChangeName = (v: string) => {
    setName(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const cleaned = v.trim();
      if (cleaned.length >= 3) doReclass(cleaned);
    }, 900);
  };

  const onBlur = () => {
    const cleaned = name.trim();
    if (cleaned.length > 0) doReclass(cleaned);
  };

  const onEnter: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const cleaned = name.trim();
    if (cleaned.length > 0) doReclass(cleaned);
  };

  return (
    <div className="rounded-xl border p-3 shadow-sm hover:shadow-md transition-shadow bg-white">
      <div className="relative aspect-square bg-muted rounded-lg overflow-hidden group">
        <img
          src={item.url}
          alt={item.name}
          loading="lazy"
          className="w-full h-full object-contain bg-white"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
            (e.currentTarget as HTMLImageElement).style.background = "#f8f9fa";
          }}
        />
        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary"> <Eye className="h-4 w-4" /> </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>{item.name}</DialogTitle></DialogHeader>
              <div className="flex justify-center">
                <img src={item.url} alt={item.name} className="max-w-full max-h-[70vh] object-contain" />
              </div>
              {reason ? <p className="text-sm text-muted-foreground mt-2">Motivo: {reason}</p> : null}
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="secondary" asChild>
            <a href={item.url} download={item.name}><Download className="h-4 w-4" /></a>
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <p className="mt-2 text-sm font-medium truncate">{item.name}</p>

      <div className="mt-2 space-y-1">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <Tag className="h-3 w-3" /> Nombre comercial
        </Label>
        <Input
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onKeyDown={onEnter}
          onBlur={onBlur}
          placeholder="Escribe el nombre comercial"
          className={inputAlwaysVisible}
        />
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => doReclass()} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reclasificar</>}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {item.hsCode ? <Badge variant="outline">HS: {item.hsCode}</Badge> : null}
        {typeof item.confidence === "number" ? <Badge variant="outline">Confianza: {Math.round((item.confidence ?? 0) * 100)}%</Badge> : null}
      </div>
    </div>
  );
}

function ImageRow({
  item, onApply, onDelete,
}: { item: Item; onApply: (patch: Partial<Item>) => void; onDelete: () => void; }) {
  const [name, setName] = useState(item.commercialName || "");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);
  const lastSentRef = useRef<string>(item.commercialName || "");

  useEffect(() => {
    setName(item.commercialName || "");
    lastSentRef.current = item.commercialName || "";
  }, [item.id]);

  const doReclass = async (forcedName?: string) => {
    const nameToUse = (forcedName ?? name ?? "").trim();
    if (!nameToUse) return;
    setLoading(true);
    try {
      const res = await fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: item.url, commercialName: nameToUse }),
      });
      if (res.ok) {
        const payload = await res.json();
        const nextHs = (payload.hsCode || "").replace(/\D/g, "").slice(0, 6);
        const nextName = payload.commercialName || nameToUse;
        onApply({ hsCode: nextHs, commercialName: nextName, nombre_comercial: nextName, reason: payload.reason || "" });
        lastSentRef.current = nameToUse;
      }
    } finally {
      setLoading(false);
    }
  };

  const onChangeName = (v: string) => {
    setName(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const cleaned = v.trim();
      if (cleaned.length >= 3) doReclass(cleaned);
    }, 900);
  };

  const onBlur = () => {
    const cleaned = name.trim();
    if (cleaned.length > 0) doReclass(cleaned);
  };

  const onEnter: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const cleaned = name.trim();
    if (cleaned.length > 0) doReclass(cleaned);
  };

  return (
    <div className="flex items-start gap-4 p-3 rounded-lg border bg-white">
      <div className="relative w-20 h-20 bg-muted rounded overflow-hidden flex-shrink-0">
        <img src={item.url} alt={item.name} className="w-full h-full object-contain bg-white" />
        <div className="absolute inset-0 bg-black/45 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="secondary"><Eye className="h-4 w-4" /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>{item.name}</DialogTitle></DialogHeader>
              <div className="flex justify-center">
                <img src={item.url} alt={item.name} className="max-w-full max-h-[70vh] object-contain" />
              </div>
              {item.reason ? <p className="text-sm text-muted-foreground mt-2">Motivo: {item.reason}</p> : null}
            </DialogContent>
          </Dialog>
          <Button size="icon" variant="secondary" asChild>
            <a href={item.url} download={item.name}><Download className="h-4 w-4" /></a>
          </Button>
          <Button size="icon" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.name}</p>
        <div className="flex flex-wrap gap-1 my-1">
          {item.hsCode ? <Badge variant="outline">HS: {item.hsCode}</Badge> : null}
          {typeof item.confidence === "number" ? <Badge variant="outline">Confianza: {Math.round((item.confidence ?? 0) * 100)}%</Badge> : null}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Nombre comercial</Label>
            <Input
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              onKeyDown={onEnter}
              onBlur={onBlur}
              placeholder="Escribe el nombre comercial"
              className={inputAlwaysVisible}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => doReclass()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reclasificar</>}
          </Button>
        </div>
        {item.reason ? <p className="text-sm text-muted-foreground mt-1">Motivo: {item.reason}</p> : null}
      </div>
    </div>
  );
}
