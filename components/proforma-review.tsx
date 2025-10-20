// components/ui/proforma-review.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, UploadCloud } from "lucide-react";

type Row = {
  item_no?: string | number | null;
  commercial_name?: string | null;
  model?: string | null;
  color?: string | null;
  size?: string | null;
  qty?: number | null;
  package?: number | null;
  unit_price?: number | null;
  total_amount?: number | null;
  hs_code?: string | null;
  picture_url?: string | null;
  notes?: string | null;
};

type ParseResponse = {
  meta: Record<string, any>;
  columns: string[];
  rows: Row[];
  warnings?: string[];
  confidence?: any;
};

export default function ProformaReview({
  onComplete,
  folderUrl = "",                 // 👈 pásalo desde tu layout/página (o ponlo fijo)
  docName = "Liquidación",        // 👈 idem
}: {
  onComplete: (data: any) => void;
  folderUrl?: string;
  docName?: string;
}) {
  const [fileName, setFileName] = useState<string>("");
  const [fileObj, setFileObj] = useState<File | null>(null);     // 👈 guardamos el File
  const [data, setData] = useState<ParseResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [warns, setWarns] = useState<string[]>([]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileObj(f);                      // 👈 guardamos el File para el paso siguiente
    setFileName(f.name);
    setLoading(true);
    setWarns([]);
    setRows([]);
    setData(null);

    try {
      // 1) Parser por tablas
      const form = new FormData();
      form.append("file", f);
      let res = await fetch("/api/proforma", { method: "POST", body: form });
      let json = await res.json();

      // 2) Fallback a IA si no hubieron filas
      if (!Array.isArray(json.rows) || json.rows.length === 0) {
        const form2 = new FormData();
        form2.append("file", f);
        const ai = await fetch("/api/proforma/ai", { method: "POST", body: form2 });
        const jsonAI = await ai.json();
        json = jsonAI;
        setWarns([...(json.warnings || []), "Resultado generado con IA (modo visión)."]);
      } else {
        setWarns(json.warnings || []);
      }

      setData(json);
      setRows(json.rows || []);
    } catch (err: any) {
      setWarns([`Error subiendo/parseando: ${err?.message || err}`]);
    } finally {
      setLoading(false);
    }
  }

  function updateCell(i: number, k: keyof Row, v: any) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  }

  // 👉 AHORA sí: “Continuar” llama a /api/liquidacion con proforma_rows
  async function continuar() {
    if (!fileObj) {
      setWarns(["Primero sube un PDF/imagen de proforma."]);
      return;
    }
    if (!folderUrl) {
      setWarns(["Falta la carpeta de Drive (folderUrl)."]);
      return;
    }

    try {
      setLoading(true);
      const fd = new FormData();
      fd.append("pdf_file", fileObj);
      fd.append("doc_name", docName || fileName || "Liquidación");
      fd.append("folder_url", folderUrl);
      fd.append("proforma_rows", JSON.stringify(rows));  // 👈 CLAVE

      const resp = await fetch("/api/liquidacion", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${resp.status}`);
      }
      const payload = await resp.json();

      // 👉 Enviamos al paso siguiente (ResultsGrid espera {documentName, folderUrl, items, ...})
      onComplete(payload);
    } catch (e: any) {
      setWarns([`Error preparando liquidación: ${e?.message || e}`]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Lector de Proformas</h1>
        <p className="text-muted-foreground">
          Sube una proforma (PDF / Imagen / Excel). La convertiremos en una tabla editable. Aquí solo revisas;
          la hoja de Google se generará en el paso de liquidación.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Subir archivo</CardTitle>
            <CardDescription>Formatos soportados: PDF, PNG/JPG, XLSX/XLS/CSV</CardDescription>
          </div>
          {fileName ? <Badge variant="outline">{fileName}</Badge> : null}
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer hover:bg-neutral-900">
            <UploadCloud className="h-5 w-5 opacity-80" />
            <span className="text-sm">Seleccionar archivo…</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
              onChange={onUpload}
            />
            {loading && (
              <span className="ml-auto text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Procesando…
              </span>
            )}
          </label>

          {warns.length > 0 && (
            <Alert className="mt-4">
              <AlertTitle>Observaciones</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 space-y-1">
                  {warns.map((w, i) => (
                    <li key={i} className="text-sm">
                      {w}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Tabla editable (misma que tenías) */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Datos detectados</CardTitle>
          <CardDescription>Edita lo necesario antes de continuar</CardDescription>
        </CardHeader>

        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 sticky top-0 z-10">
                  <tr className="[&>th]:font-medium [&>th]:whitespace-nowrap">
                    {[
                      "item_no","commercial_name","model","color","size",
                      "qty","package","unit_price","total_amount","hs_code","picture_url","notes"
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 text-left border-b border-neutral-200 dark:border-neutral-800">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                {rows.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-neutral-500">
                        Sube una proforma para visualizar la tabla.
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <tbody>
                    {rows.map((r, i) => {
                      const cells = {
                        item_no: r.item_no ?? "",
                        commercial_name: r.commercial_name ?? "",
                        model: r.model ?? "",
                        color: r.color ?? "",
                        size: r.size ?? "",
                        qty: r.qty ?? "",
                        package: r.package ?? "",
                        unit_price: r.unit_price ?? "",
                        total_amount: r.total_amount ?? "",
                        hs_code: r.hs_code ?? "",
                        picture_url: r.picture_url ?? "",
                        notes: r.notes ?? "",
                      };

                      return (
                        <tr key={i} className="border-b border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition">
                          {Object.entries(cells).map(([k, val]) => {
                            const isNumeric = ["qty","package","unit_price","total_amount"].includes(k);
                            return (
                              <td key={k} className="px-2 py-1.5 align-middle">
                                <input
                                  className={[
                                    "w-full rounded-md",
                                    "px-2 py-1.5 outline-none",
                                    "bg-white text-neutral-900 border border-neutral-300",
                                    "dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700",
                                    "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
                                    "focus:ring-2 focus:ring-emerald-500/50"
                                  ].join(" ")}
                                  value={(val as any) ?? ""}
                                  onChange={(e) =>
                                    updateCell(
                                      i,
                                      k as keyof typeof r,
                                      isNumeric
                                        ? (e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")))
                                        : e.target.value
                                    )
                                  }
                                  inputMode={isNumeric ? "decimal" : "text"}
                                  style={isNumeric ? { textAlign: "right", fontVariantNumeric: "tabular-nums" } : {}}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => { setRows([]); setData(null); setFileObj(null); setFileName(""); }}>
              Limpiar
            </Button>
            <Button disabled={!rows.length || !fileObj || loading} onClick={continuar} className="bg-emerald-600">
              Continuar → Resultados
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
