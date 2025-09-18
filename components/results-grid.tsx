"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExternalLink, Download, Eye, Grid, List, Loader2, Tag, Trash2 } from "lucide-react";

type NormalizedItem = {
  id: string;
  url: string;     // data URL para preview
  name: string;
  hsCode: string;
  commercialName: string;
  confidence: number | null;
  reason: string;
  _b64?: string;   // base64
};

interface ResultsGridProps { data: any; }

export function ResultsGrid({ data }: ResultsGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const rows0: NormalizedItem[] = useMemo(() => {
    const raw: any[] = (data?.images ?? []) as any[];
    return raw.map((r, idx) => ({
      id: r.id ?? `${idx}-${r.name}`,
      url: r.url ?? "/placeholder.svg",
      name: r.name ?? `image_${String(idx + 1).padStart(3, "0")}.png`,
      hsCode: r.hsCode ?? r.classification?.hs_code ?? "",
      commercialName: r.commercialName ?? r.classification?.commercial_name ?? "",
      confidence:
        typeof (r.confidence ?? r.classification?.confidence) === "number"
          ? (r.confidence ?? r.classification?.confidence)
          : null,
      reason: r.reason ?? r.classification?.reason ?? "",
      _b64: r._b64 || (r.url?.startsWith("data:") ? r.url.split(",")[1] : undefined),
    }));
  }, [data]);

  const [rows, setRows] = useState<NormalizedItem[]>(rows0);
  const [reclassing, setReclassing] = useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = useState(false);

  useEffect(() => setRows(rows0), [rows0]);

  if (!data) return null;
  const total = rows.length;

  const setCommercialFor = (id: string, value: string) =>
    setRows((prev) => prev.map((it) => (it.id === id ? { ...it, commercialName: value } : it)));

  const handleDelete = (id: string) => setRows((prev) => prev.filter((it) => it.id !== id));

  const handleReclassify = async (row: NormalizedItem) => {
    setReclassing((s) => ({ ...s, [row.id]: true }));
    try {
      const res = await fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageB64: row._b64, commercialName: row.commercialName || undefined }),
      });
      if (res.ok) {
        const payload = await res.json();
        setRows((prev) =>
          prev.map((it) =>
            it.id === row.id
              ? {
                  ...it,
                  hsCode: payload.hsCode ?? it.hsCode,
                  commercialName: payload.commercialName ?? it.commercialName,
                  confidence: typeof payload.confidence === "number" ? payload.confidence : it.confidence,
                  reason: payload.reason ?? it.reason,
                }
              : it
          )
        );
      }
    } finally {
      setReclassing((s) => ({ ...s, [row.id]: false }));
    }
  };

  const handlePublish = async () => {
    if (!rows.length) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          documentName: data?.documentName || "Documento",
          folderUrl: data?.folderUrl,
          items: rows.map((r) => ({
            name: r.name,
            b64: r._b64,
            hsCode: r.hsCode,
            commercialName: r.commercialName,
            confidence: r.confidence ?? 0,
            reason: r.reason || "",
          })),
        }),
      });
      const out = await res.json();
      if (!res.ok || !out?.success) throw new Error(out?.error || "Error publicando");
      window.open(out.sheetUrl, "_blank", "noopener,noreferrer");
      alert(`Publicado ${out.rows} filas.\nSheet: ${out.sheetUrl}`);
    } catch (e: any) {
      alert("Error: " + (e?.message || e));
    } finally {
      setPublishing(false);
    }
  };

  const ImageTile = ({ image }: { image: NormalizedItem }) => (
    <div className="rounded-lg border p-2">
      <div className="relative aspect-square bg-muted rounded-md overflow-hidden group">
        <img src={image.url} alt={image.name} loading="lazy" className="w-full h-full object-contain bg-white" />
        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="pointer-events-auto">
                <Eye className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>{image.name}</DialogTitle></DialogHeader>
              <div className="flex justify-center">
                <img src={image.url} alt={image.name} className="max-w-full max-h-[70vh] object-contain" />
              </div>
              {image.reason ? <p className="text-sm text-muted-foreground mt-2">Reason: {image.reason}</p> : null}
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="secondary" asChild>
            <a href={image.url} download={image.name}><Download className="h-4 w-4" /></a>
          </Button>
        </div>
      </div>

      <p className="mt-2 text-sm font-medium truncate">{image.name}</p>

      <div className="mt-2 space-y-1">
        <Label htmlFor={`com-${image.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
          <Tag className="h-3 w-3" /> Nombre comercial
        </Label>
        <Input
          id={`com-${image.id}`}
          value={image.commercialName}
          onChange={(e) => setCommercialFor(image.id, e.target.value)}
          placeholder="Ej. Llavero de plástico / Jeep de juguete"
        />

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="destructive" className="gap-2" onClick={() => handleDelete(image.id)}>
            <Trash2 className="h-4 w-4" /> Eliminar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleReclassify(image)} disabled={!!reclassing[image.id]}>
            {reclassing[image.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reclasificar</>}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {image.hsCode ? <Badge variant="outline">HS: {image.hsCode}</Badge> : null}
        {typeof image.confidence === "number" ? <Badge variant="outline">Conf: {Math.round(image.confidence * 100)}%</Badge> : null}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Revisión previa</h1>
          <p className="text-muted-foreground">
            {total} imágenes listas. Elimina/edita y luego publica.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="sm" onClick={() => setViewMode("grid")}><Grid className="h-4 w-4" /></Button>
          <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" onClick={() => setViewMode("list")}><List className="h-4 w-4" /></Button>
          <Button onClick={handlePublish} disabled={!rows.length || publishing}>
            {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Publicar a Google Sheets
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Imágenes extraídas</CardTitle>
          <CardDescription>Revisa, edita y elimina. Nada se sube todavía.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay imágenes para mostrar.</p>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {rows.map((image) => (<ImageTile key={image.id} image={image} />))}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((image) => (
                <div key={image.id} className="flex items-start gap-4 p-3 rounded-lg border">
                  <div className="relative w-20 h-20 bg-muted rounded overflow-hidden flex-shrink-0">
                    <img src={image.url} alt={image.name} className="w-full h-full object-contain bg-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{image.name}</p>
                    <div className="flex flex-wrap gap-1 my-1">
                      {image.hsCode ? <Badge variant="outline">HS: {image.hsCode}</Badge> : null}
                      {typeof image.confidence === "number" ? <Badge variant="outline">Conf: {Math.round(image.confidence * 100)}%</Badge> : null}
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label htmlFor={`com-${image.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
                          <Tag className="h-3 w-3" /> Nombre comercial
                        </Label>
                        <Input
                          id={`com-${image.id}`}
                          value={image.commercialName}
                          onChange={(e) => setCommercialFor(image.id, e.target.value)}
                          placeholder="Ej. Llavero de plástico / Jeep de juguete"
                        />
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(image.id)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleReclassify(image)} disabled={!!reclassing[image.id]}>
                        {reclassing[image.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reclasificar</>}
                      </Button>
                    </div>
                    {image.reason ? <p className="text-sm text-muted-foreground mt-1">Reason: {image.reason}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
