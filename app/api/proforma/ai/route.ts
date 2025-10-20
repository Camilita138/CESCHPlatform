// app/api/proforma/ai/route.ts
import { NextRequest, NextResponse } from "next/server";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import OpenAI from "openai";

export const runtime = "nodejs";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const PY_CMD = process.env.PYTHON_CMD || "python";

function runPython(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(PY_CMD, args, { cwd, env: process.env, stdio: ["ignore","pipe","pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(err || `python exit ${code}`)));
  });
}

function inferMime(name: string): "pdf"|"image" {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["pdf"].includes(ext)) return "pdf";
  return "image";
}

function cleanNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/[, $]/g, "");
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// normaliza filas a tu esquema en español
function normalizeRows(rows: any[]): any[] {
  return (rows || []).map((r) => {
    const out: any = {
      nombre_comercial: r?.nombre_comercial ?? r?.commercial_name ?? null,
      descripcion: r?.descripcion ?? null,
      modelo: r?.modelo ?? r?.model ?? null,
      unidad_de_medida: r?.unidad_de_medida || "PZA",
      cantidad_x_caja: cleanNumber(r?.cantidad_x_caja),
      cajas: cleanNumber(r?.cajas),
      total_unidades: cleanNumber(r?.total_unidades),
      partida: (r?.partida ?? r?.hs_code ?? r?.hsCode ?? "")
        .toString().replace(/\D/g, "").slice(0, 10) || null,
      precio_unitario_usd: cleanNumber(r?.precio_unitario_usd),
      total_usd: cleanNumber(r?.total_usd),
      proveedores: r?.proveedores ?? null,
      link_de_la_imagen: r?.link_de_la_imagen ?? r?.picture_url ?? null,
    };

    if (out.total_unidades == null && out.cantidad_x_caja != null && out.cajas != null) {
      out.total_unidades = +(out.cantidad_x_caja * out.cajas).toFixed(0);
    }
    return out;
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ rows: [], warnings: ["Falta 'file'"] }, { status: 400 });
    }

    // Guardar temporal
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const tmpPath = path.join(os.tmpdir(), file.name);
    await writeFile(tmpPath, buf);

    // Construir inputs de visión
    const kind = inferMime(file.name);
    let imagesB64: string[] = [];

    if (kind === "image") {
      imagesB64 = [buf.toString("base64")];
    } else {
      // PDF ⇒ rasterizar (usa tu script existente)
      const pyPath = path.join(process.cwd(), "scripts", "pdf_to_images_b64.py");
      await access(pyPath);
      const out = await runPython([pyPath, tmpPath, "3"], process.cwd()); // primeras 3 páginas
      const j = JSON.parse(out);
      imagesB64 = j.images || [];
      if (!imagesB64.length) {
        return NextResponse.json({
          rows: [],
          warnings: ["No pude rasterizar el PDF para visión."],
        });
      }
    }

    // Prompt en español con TU esquema de columnas
    const system = [
      "Eres un asistente que extrae los ítems de una PROFORMA o FACTURA PROFORMA.",
      "Devuelve SOLO JSON válido con este shape:",
      "{",
      '  "rows": [',
      "    {",
      '      "nombre_comercial": string | null,',
      '      "descripcion": string | null,',
      '      "modelo": string | null,',
      '      "unidad_de_medida": string | null,',
      '      "cantidad_x_caja": number | null,',
      '      "cajas": number | null,',
      '      "total_unidades": number | null,',
      '      "partida": string | null,',
      '      "precio_unitario_usd": number | null,',
      '      "total_usd": number | null,',
      '      "proveedores": string | null,',
      '      "link_de_la_imagen": string | null',
      "    }",
      "  ]",
      "}",
      "Reglas:",
      "- Ignora cabeceras, subtotales y total general.",
      "- Si faltan datos, deja null.",
      "- Usa números (no strings) para cantidades y precios.",
      "- La columna PARTIDA debe ser la partida arancelaria (solo dígitos).",
      "- UNIDAD_DE_MEDIDA por defecto 'PZA' si no aparece.",
    ].join(" ");

    const content: any[] = [
      { type: "text", text: "Extrae las filas de la proforma según el esquema en español. Responde SOLO JSON válido." }
    ];
    imagesB64.slice(0, 3).forEach((b64) => {
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } });
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content }
      ]
    });

    let payload: any = {};
    try { payload = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch {}

    const rows = normalizeRows(Array.isArray(payload.rows) ? payload.rows : []);

    return NextResponse.json({
      rows,
      warnings: rows.length ? [] : ["La IA no encontró filas claras. Revisa el archivo o sube una imagen más legible."]
    });
  } catch (e: any) {
    return NextResponse.json({ rows: [], warnings: [`AI error: ${e?.message || e}`] }, { status: 500 });
  }
}
