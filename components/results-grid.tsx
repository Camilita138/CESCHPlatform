"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Download, Eye, Grid, List } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type ApiClassification = {
  imageUrl?: string;
  imageName?: string;
  hsCode?: string;
  commercialName?: string;
  confidence?: number;
  reason?: string;

  url?: string;
  name?: string;
  classification?: {
    hs_code?: string;
    commercial_name?: string;
    confidence?: number;
    reason?: string;
  };

  size?: number;
  id?: string;
};

type NormalizedItem = {
  id: string;
  url: string;
  name: string;
  size?: number;
  hsCode: string;
  commercialName: string;
  confidence: number | null;
  reason: string;
};

interface ResultsGridProps {
  data: any;
}

/** Convierte enlaces de Google Drive a un link embebible en <img>. */
function ensurePublicImage(rawUrl?: string): string {
  if (!rawUrl) return "/placeholder.svg";
  try {
    // Extrae fileId de distintos formatos de Drive
    const mFile = rawUrl.match(/\/file\/d\/([^/]+)\//); // .../file/d/<ID>/view
    const mUc = rawUrl.match(/[?&]id=([^&]+)/);        // ...uc?export=view&id=<ID>
    const fileId = (mFile && mFile[1]) || (mUc && mUc[1]) || "";

    if (fileId) {
      // link de imagen directa que carga en <img>
      return `https://lh3.googleusercontent.com/d/${fileId}=s1200`;
    }

    // Si ya es lh3 o es URL normal, lo devolvemos
    if (/lh3\.googleusercontent\.com/.test(rawUrl)) return rawUrl;
    return rawUrl;
  } catch {
    return rawUrl || "/placeholder.svg";
  }
}

export function ResultsGrid({ data }: ResultsGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  if (!data) return null;

  // Fuente única de datos (prefiere el shape de la API nueva)
  const raw: ApiClassification[] = (data?.classifications ?? data?.images ?? []) as ApiClassification[];

  // Normaliza para render estable
  const images: NormalizedItem[] = raw.map((r, idx) => {
    const originalUrl = r.imageUrl ?? r.url ?? "/placeholder.svg";
    const url = ensurePublicImage(originalUrl);
    const name = r.imageName ?? r.name ?? `image_${String(idx + 1).padStart(3, "0")}.png`;
    const hs = r.hsCode ?? r.classification?.hs_code ?? "";
    const com = r.commercialName ?? r.classification?.commercial_name ?? "";
    const conf = (r.confidence ?? r.classification?.confidence) as number | undefined;
    const reason = r.reason ?? r.classification?.reason ?? "";
    return {
      id: r.id ?? `${idx}-${name}`,
      url,
      name,
      size: r.size,
      hsCode: hs || "",
      commercialName: com || "",
      confidence: typeof conf === "number" ? conf : null,
      reason,
    };
  });

  const total = data?.totalImages ?? images.length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Processing Complete</h1>
          <p className="text-muted-foreground">
            Successfully extracted {total} images
            {data?.documentName ? <> from "{data.documentName}"</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="sm" onClick={() => setViewMode("grid")}>
            <Grid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" onClick={() => setViewMode("list")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Images</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
              <Badge variant="secondary">{total} files</Badge>
            </div>
          </CardContent>
        </Card>

        {data?.sheetUrl ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Google Sheet</p>
                  <p className="text-sm font-medium truncate">Created successfully</p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href={data.sheetUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {data?.driveFolder ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Drive Folder</p>
                  <p className="text-sm font-medium truncate">Images uploaded</p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href={data.driveFolder} target="_blank" rel="noopener noreferrer">
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
          <CardTitle>Extracted Images</CardTitle>
          <CardDescription>
            All images have been uploaded to Google Drive and added to your spreadsheet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images to display.</p>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map((image) => (
                <div key={image.id} className="group relative">
                  <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                    <img
                      src={image.url}
                      alt={image.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                      }}
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-medium truncate">{image.name}</p>
                    {image.size ? <p className="text-xs text-muted-foreground">{image.size} KB</p> : null}
                    {(image.hsCode || image.commercialName) && (
                      <div className="flex flex-wrap gap-1">
                        {image.hsCode ? <Badge variant="outline">HS: {image.hsCode}</Badge> : null}
                        {image.commercialName ? <Badge variant="secondary">{image.commercialName}</Badge> : null}
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <DialogHeader>
                          <DialogTitle>{image.name}</DialogTitle>
                        </DialogHeader>
                        <div className="flex justify-center">
                          <img
                            src={image.url}
                            alt={image.name}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-[70vh] object-contain"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                            }}
                          />
                        </div>
                        {image.reason ? (
                          <p className="text-sm text-muted-foreground mt-2">Reason: {image.reason}</p>
                        ) : null}
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="secondary" asChild>
                      <a href={image.url} download={image.name}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {images.map((image) => (
                <div key={image.id} className="flex items-center gap-4 p-3 rounded-lg border">
                  <div className="w-12 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                    <img
                      src={image.url}
                      alt={image.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{image.name}</p>
                    {image.size ? <p className="text-sm text-muted-foreground">{image.size} KB</p> : null}
                    {(image.hsCode || image.commercialName || typeof image.confidence === "number") && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {image.hsCode ? <Badge variant="outline">HS: {image.hsCode}</Badge> : null}
                        {image.commercialName ? <Badge variant="secondary">{image.commercialName}</Badge> : null}
                        {typeof image.confidence === "number" ? (
                          <Badge variant="outline">Conf: {Math.round(image.confidence * 100)}%</Badge>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <DialogHeader>
                          <DialogTitle>{image.name}</DialogTitle>
                        </DialogHeader>
                        <div className="flex justify-center">
                          <img
                            src={image.url}
                            alt={image.name}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-[70vh] object-contain"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                            }}
                          />
                        </div>
                        {image.reason ? (
                          <p className="text-sm text-muted-foreground mt-2">Reason: {image.reason}</p>
                        ) : null}
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="outline" asChild>
                      <a href={image.url} download={image.name}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
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
