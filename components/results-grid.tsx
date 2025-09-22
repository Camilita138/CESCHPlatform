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

/* ================= Tipos ================= */

type ApiImage = {
  id?: string;
  url?: string;            // data URL o URL de Drive
  name?: string;
  b64?: string;
  _b64?: string;           // compat
  hsCode?: string;
  commercialName?: string;
  confidence?: number | null;
  reason?: string;
  classification?: {
    hs_code?: string;
    commercial_name?: string;
    confidence?: number;
    reason?: string;
  };
  size?: number;
};

export type Item = {
  id: string;
  url: string;
  name: string;
  b64?: string; // puede venir base64 desde prep
  hsCode: string;
  commercialName: string;
  confidence: number | null;
  reason: string;
};

interface ResultsGridProps {
  /** PREP payload: { documentName, folderUrl, totalImages, images: [...] } */
  data: any;
  /** opcional, se llama en acciones grandes (eliminar/publicar) */
  onChangeItems?: (items: Item[]) => void;
}

/* =============== Helpers UI =============== */

const inputAlwaysVisible =
  "h-11 bg-white border border-muted-foreground/40 shadow-sm " +
  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 " +
  "placeholder:text-muted-foreground";

/* =============== Componente principal =============== */

export function ResultsGrid({ data, onChangeItems }: ResultsGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [publishing, setPublishing] = useState(false);
  const [publishOk, setPublishOk] = useState<{sheetUrl: string; total: number} | null>(null);
  const documentName: string = data?.documentName || "Liquidación";
  const folderUrl: string = data?.folderUrl || "";

  // Normaliza SOLO una vez
  const initialRows: Item[] = useMemo(() => {
    const raw: ApiImage[] = (data?.images ?? data?.classifications ?? []) as ApiImage[];
    return raw.map((r, idx) => {
      const id = r.id || `img${idx + 1}`;
      const url =
        r.url ||
        (r._b64 || r.b64 ? `data:image/png;base64,${r._b64 || r.b64}` : "/placeholder.svg");

      const conf =
        typeof (r.confidence ?? r.classification?.confidence) === "number"
          ? (r.confidence ?? r.classification?.confidence)!
          : null;

      const hsRaw = r.hsCode || r.classification?.hs_code || "";
      const hs6 = hsRaw ? String(hsRaw).replace(/\D/g, "").slice(0, 6) : "";

      return {
        id,
        url,
        name: r.name || `image_${String(idx + 1).padStart(3, "0")}.png`,
        b64: r._b64 || r.b64,
        hsCode: hs6,
        commercialName: r.commercialName || r.classification?.commercial_name || "",
        confidence: conf,
        reason: r.reason || r.classification?.reason || "",
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.images, data?.classifications]);

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

  /* ======= Publicar a Sheets (commit) ======= */

  async function publishToSheets() {
    if (!folderUrl) {
      alert("Falta la URL/ID de Carpeta de Google Drive (folderUrl).");
      return;
    }
    if (rows.length === 0) {
      alert("No hay imágenes para publicar.");
      return;
    }

    setPublishing(true);
    setPublishOk(null);
    try {
      // armamos payload para el commit
      const items = rows.map((r) => ({
        name: r.name,
        url: r.url,                     // si es data URL, tu backend re-sube desde b64 si lo necesita
        hsCode: (r.hsCode || "").replace(/\D/g, "").slice(0, 6),
        commercialName: r.commercialName || "",
        confidence: r.confidence ?? 0,
        reason: r.reason || "",
        // si tu commit usa b64: descomenta y el backend lo usará
        // b64: r.b64,
      }));

      const resp = await fetch("/api/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          documentName,
          folderUrl,
          items,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${resp.status}`);
      }

      const out = await resp.json();
      setPublishOk({ sheetUrl: out.sheetUrl, total: out.total ?? items.length });
    } catch (e: any) {
      alert(`Error al publicar: ${e?.message || e}`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header + CTA publicar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Revisión previa</h1>
          <p className="text-muted-foreground">
            {total} imágenes listas. IA clasifica ahora y también después de editar el nombre.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={publishToSheets}
            disabled={publishing || total === 0}
            className="gap-2"
          >
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

      {/* Aviso de éxito */}
      {publishOk ? (
        <Card className="border-green-600/30">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-medium">¡Publicado! {publishOk.total} filas creadas.</p>
                <p className="text-sm text-muted-foreground">
                  Tu hoja está lista. Puedes abrirla para revisarla y compartirla.
                </p>
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

      {/* Métricas rápidas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
              <Badge variant="secondary">{total} files</Badge>
            </div>
          </CardContent>
        </Card>

        {data?.folderUrl ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Drive Folder</p>
                  <p className="text-sm font-medium truncate">Aún no publicado</p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href={data.folderUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Imágenes extraídas</CardTitle>
          <CardDescription>
            Se clasifica al terminar de teclear (900 ms), al presionar Enter o al salir del campo.
          </CardDescription>
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
                  onApply={(p) => applyUpdate(item.id, p)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((item) => (
                <ImageRow
                  key={item.id}
                  item={item}
                  onApply={(p) => applyUpdate(item.id, p)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ===================== Tarjeta (estado local, memo) ===================== */

type CardProps = {
  item: Item;
  onApply: (patch: Partial<Item>) => void;
  onDelete: () => void;
};

const ImageCard = React.memo(function ImageCard({ item, onApply, onDelete }: CardProps) {
  // estado LOCAL (no depende del padre por cada tecla)
  const [name, setName] = useState(item.commercialName || "");
  const [hs, setHs] = useState(item.hsCode || "");
  const [conf, setConf] = useState<number | null>(item.confidence ?? null);
  const [reason, setReason] = useState(item.reason || "");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);
  const lastSentRef = useRef<string>(item.commercialName || "");

  // reset si cambia la tarjeta
  useEffect(() => {
    setName(item.commercialName || "");
    setHs(item.hsCode || "");
    setConf(item.confidence ?? null);
    setReason(item.reason || "");
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
        body: JSON.stringify({
          imageUrl: item.url, // data URL o Drive
          commercialName: nameToUse || undefined,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        const nextHs = (payload.hsCode || "").replace(/\D/g, "").slice(0, 6);
        const nextName = payload.commercialName || nameToUse;
        const nextConf = typeof payload.confidence === "number" ? payload.confidence : null;
        const nextReason = payload.reason || "";

        setHs(nextHs);
        setConf(nextConf);
        setReason(nextReason);
        lastSentRef.current = nameToUse;

        onApply({
          hsCode: nextHs,
          commercialName: nextName,
          confidence: nextConf,
          reason: nextReason,
        });
      }
    } catch (e) {
      console.warn("reclassify error", e);
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
    <div className="rounded-xl border p-3 shadow-sm hover:shadow-md transition-shadow bg-white">
      {/* IMG BOX */}
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

        {/* overlay con 3 acciones */}
        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {/* Ver */}
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="pointer-events-auto">
                <Eye className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{item.name}</DialogTitle>
              </DialogHeader>
              <div className="flex justify-center">
                <img src={item.url} alt={item.name} className="max-w-full max-h-[70vh] object-contain" />
              </div>
              {reason ? <p className="text-sm text-muted-foreground mt-2">Motivo: {reason}</p> : null}
            </DialogContent>
          </Dialog>

          {/* Descargar */}
          <Button size="sm" variant="secondary" asChild>
            <a href={item.url} download={item.name}>
              <Download className="h-4 w-4" />
            </a>
          </Button>

          {/* Eliminar */}
          <Button size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Meta */}
      <p className="mt-2 text-sm font-medium truncate">{item.name}</p>

      {/* Nombre comercial */}
      <div className="mt-2 space-y-1">
        <Label htmlFor={`com-${item.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
          <Tag className="h-3 w-3" /> Nombre comercial
        </Label>
        <Input
          id={`com-${item.id}`}
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onKeyDown={onEnter}
          onBlur={onBlur}
          placeholder="Escribe el nombre comercial"
          className={inputAlwaysVisible}
        />

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => doReclass()}
            disabled={loading}
            className="gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reclasificar</>}
          </Button>
        </div>
      </div>

      {/* Chips: HS + Confianza */}
      <div className="mt-2 flex flex-wrap gap-1">
        {hs ? <Badge variant="outline">HS: {hs}</Badge> : null}
        {typeof conf === "number" ? <Badge variant="outline">Confianza: {Math.round(conf * 100)}%</Badge> : null}
      </div>
    </div>
  );
});

/* ================ Variante lista (misma lógica, diseño en fila) ================ */

const ImageRow = React.memo(function ImageRow({ item, onApply, onDelete }: CardProps) {
  const [name, setName] = useState(item.commercialName || "");
  const [hs, setHs] = useState(item.hsCode || "");
  const [conf, setConf] = useState<number | null>(item.confidence ?? null);
  const [reason, setReason] = useState(item.reason || "");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);
  const lastSentRef = useRef<string>(item.commercialName || "");

  useEffect(() => {
    setName(item.commercialName || "");
    setHs(item.hsCode || "");
    setConf(item.confidence ?? null);
    setReason(item.reason || "");
    lastSentRef.current = item.commercialName || "";
  }, [item.id]);

  const doReclass = async (forcedName?: string) => {
    const nameToUse = (forcedName ?? name ?? "").trim();
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
        const nextConf = typeof payload.confidence === "number" ? payload.confidence : null;
        const nextReason = payload.reason || "";
        setHs(nextHs);
        setConf(nextConf);
        setReason(nextReason);
        lastSentRef.current = nameToUse;
        onApply({ hsCode: nextHs, commercialName: nextName, confidence: nextConf, reason: nextReason });
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
        <img
          src={item.url}
          alt={item.name}
          className="w-full h-full object-contain bg-white"
          onError={(e) => ((e.currentTarget as HTMLImageElement).src = "/placeholder.svg")}
        />
        <div className="absolute inset-0 bg-black/45 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="secondary">
                <Eye className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{item.name}</DialogTitle>
              </DialogHeader>
              <div className="flex justify-center">
                <img src={item.url} alt={item.name} className="max-w-full max-h-[70vh] object-contain" />
              </div>
              {reason ? <p className="text-sm text-muted-foreground mt-2">Motivo: {reason}</p> : null}
            </DialogContent>
          </Dialog>
          <Button size="icon" variant="secondary" asChild>
            <a href={item.url} download={item.name}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <Button size="icon" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.name}</p>
        <div className="flex flex-wrap gap-1 my-1">
          {hs ? <Badge variant="outline">HS: {hs}</Badge> : null}
          {typeof conf === "number" ? <Badge variant="outline">Confianza: {Math.round(conf * 100)}%</Badge> : null}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={`com-${item.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" /> Nombre comercial
            </Label>
            <Input
              id={`com-${item.id}`}
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

        {reason ? <p className="text-sm text-muted-foreground mt-1">Motivo: {reason}</p> : null}
      </div>
    </div>
  );
});
