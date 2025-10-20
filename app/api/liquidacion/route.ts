// app/api/liquidacion/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ----------------------- Utils ----------------------- */
function extractFolderId(folderUrl: string): string | null {
  if (!folderUrl) return null;
  const byPath = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = folderUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (byQuery) return byQuery[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(folderUrl)) return folderUrl;
  return null;
}

async function runPy(scriptName: string, args: string[]) {
  const pythonExe = process.env.PYTHON_PATH || "python";
  const scriptPath = join(process.cwd(), "scripts", scriptName);
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = spawn(pythonExe, [scriptPath, ...args], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

function parseJsonLoose(s: string) {
  try {
    const t = (s || "").trim().replace(/^\uFEFF/, "");
    return JSON.parse(t);
  } catch {
    const text = String(s ?? "");
    const start = text.lastIndexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end >= start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Salida del script no es JSON");
  }
}

/* ----------------------- Handler ----------------------- */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  // ---------- COMMIT (JSON) ----------
  if (contentType.includes("application/json")) {
    let tmpPayloadPath: string | null = null;
    try {
      const body = await request.json();
      if (body?.action !== "commit") {
        return NextResponse.json({ error: "Acción inválida. Usa action='commit'." }, { status: 400 });
      }
      if (!body?.documentName || !body?.folderUrl || !Array.isArray(body?.items) || !body?.templateKey) {
        return NextResponse.json({ error: "Payload inválido (documentName, folderUrl, items, templateKey)" }, { status: 400 });
      }

      const folderId = extractFolderId(body.folderUrl);
      if (!folderId) {
        return NextResponse.json({ error: "URL/ID de carpeta Google Drive inválida" }, { status: 400 });
      }

      // pasar TODO al script de commit
      const itemsForPy = body.items.map((it: any, idx: number) => {
        const name = it?.name || `image_${String(idx + 1).padStart(3, "0")}.png`;
        let b64: string | null = it?._b64 || it?.b64 || null;
        if (!b64 && typeof it?.url === "string" && it.url.startsWith("data:image")) {
          const parts = it.url.split(",", 1);
          b64 = it.url.slice(parts[0].length + 1);
        }
        return {
          name,
          b64,
          hs_code: it?.hs_code ?? it?.hsCode ?? it?.partida ?? it?.classification?.hs_code ?? "",
          commercial_name: it?.commercial_name ?? it?.commercialName ?? it?.nombre_comercial ?? it?.classification?.commercial_name ?? "",
          confidence: it?.confidence ?? it?.classification?.confidence ?? "",
          reason: it?.reason ?? it?.classification?.reason ?? "",
          linkCotizador: it?.linkCotizador || it?.link_cotizador || "",
          // campos proforma
          nombre_comercial: it?.nombre_comercial ?? it?.commercialName ?? "",
          descripcion: it?.descripcion ?? "",
          unidad_de_medida: it?.unidad_de_medida ?? "",
          cantidad_x_caja: it?.cantidad_x_caja ?? null,
          cajas: it?.cajas ?? null,
          total_unidades: it?.total_unidades ?? null,
          partida: (it?.partida || it?.hs_code || it?.hsCode || "").toString().replace(/\D/g, "").slice(0, 10),
          precio_unitario_usd: it?.precio_unitario_usd ?? null,
          total_usd: it?.total_usd ?? null,
          link_de_la_imagen: it?.link_de_la_imagen ?? it?.picture_url ?? "",
          proveedores: it?.proveedores ?? "",
          modelo: it?.modelo ?? it?.model ?? "",
        };
      });

      const payload = { documentName: body.documentName, folderId, items: itemsForPy };
      tmpPayloadPath = join(tmpdir(), `commit_${Date.now()}.json`);
      await writeFile(tmpPayloadPath, JSON.stringify(payload), "utf-8");

      const { stdout, stderr, code } = await runPy("commit_liquidacion.py", [tmpPayloadPath, body.templateKey]);
      if (stderr) console.error("[commit_liquidacion stderr]", stderr);
      if (code !== 0) {
        console.error("[commit_liquidacion stdout]", stdout);
        throw new Error(`commit_liquidacion.py exit code ${code}`);
      }

      const out = parseJsonLoose(stdout);
      if (!out?.success) throw new Error(out?.error || "Commit fallido");

      return NextResponse.json({ success: true, sheetUrl: out.sheetUrl, rows: out.rows });
    } catch (e: any) {
      console.error("[/api/liquidacion commit] error:", e?.message || e);
      return NextResponse.json({ error: e?.message || "Error interno (commit)" }, { status: 500 });
    } finally {
      if (tmpPayloadPath) { try { await unlink(tmpPayloadPath); } catch {} }
    }
  }

  // ---------- PREP (multipart/form-data) ----------
  let tempFilePath: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("pdf_file") as File;
    const docName = (formData.get("doc_name") as string) || "";
    const folderUrl = (formData.get("folder_url") as string) || "";

    if (!file || !docName || !folderUrl) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY no configurada" }, { status: 500 });
    }

    // 1) Guardar PDF
    const bytes = await file.arrayBuffer();
    tempFilePath = join(tmpdir(), `upload_${Date.now()}_${(file as any).name || "file.pdf"}`);
    await writeFile(tempFilePath, Buffer.from(bytes));

    // 2) IA: leer la proforma (primeras 3 páginas)
    const parsed = await runPy("ai_parse_proforma.py", [tempFilePath, "3", process.env.OPENAI_API_KEY!]);
    const rawOutput = parsed.stdout.trim() || parsed.stderr.trim();
    if (parsed.code !== 0) {
      console.error("[ai_parse_proforma stdout]", parsed.stdout);
      throw new Error(`ai_parse_proforma.py exit code ${parsed.code}`);
    }

    // ⚠️ Algunos outputs vienen mezclados con logs o warnings, limpiamos el JSON puro
    let pr: any = {};
    try {
      pr = parseJsonLoose(rawOutput);
    } catch (err) {
      console.error("❌ Error parsing AI output:", err, "Raw:", rawOutput);
    }

    const proformaRows = Array.isArray(pr?.rows) ? pr.rows : [];
    console.log("✅ Proforma rows detectados:", proformaRows.length);



    // 3) Tu extractor: imágenes + clasificación HS
    const prep = await runPy("prep_liquidacion.py", [tempFilePath, docName, process.env.OPENAI_API_KEY!]);
    if (prep.stderr) console.error("[prep_liquidacion stderr]", prep.stderr);
    if (prep.code !== 0) {
      console.error("[prep_liquidacion stdout]", prep.stdout);
      throw new Error(`prep_liquidacion.py exit code ${prep.code}`);
    }
    const payload = parseJsonLoose(prep.stdout);
    if (!payload?.success) throw new Error(payload?.error || "Fallo en preparación");

    // 4) Mezclar por índice: proformaRows[i] + imagen/HS[i]
    const images = Array.isArray(payload.images) ? payload.images : [];
    const items = images.map((img: any, i: number) => {
      const row = proformaRows[i] || {};
      const partida = ((row.partida ?? img.hs_code) + "").replace(/\D/g, "").slice(0, 10);
      return {
        id: img.id || `img${i + 1}`,
        name: img.name || `image_${String(i + 1).padStart(3, "0")}.png`,
        url: `data:image/png;base64,${img.b64}`,
        b64: img.b64,

        // IA imágenes
        hs_code: img.hs_code || partida,
        commercial_name: img.commercial_name || row.nombre_comercial || "",
        confidence: typeof img.confidence === "number" ? img.confidence : null,
        reason: img.reason || "",
        linkCotizador: img.linkCotizador || "",

        // ===== Campos de PROFORMA (tabla editable) =====
        nombre_comercial: row.nombre_comercial ?? img.commercial_name ?? "",
        descripcion: row.descripcion ?? "",
        modelo: row.modelo ?? "",
        unidad_de_medida: row.unidad_de_medida ?? "PZA",
        cantidad_x_caja: row.cantidad_x_caja ?? null,
        cajas: row.cajas ?? null,
        total_unidades: row.total_unidades ?? null,
        partida,
        precio_unitario_usd: row.precio_unitario_usd ?? null,
        total_usd: row.total_usd ?? null,
        link_de_la_imagen: row.link_de_la_imagen ?? "",
        proveedores: row.proveedores ?? "",

        // compat con vista de imágenes
        hsCode: partida,
        commercialName: row.nombre_comercial ?? img.commercial_name ?? "",
      };
    });

    return NextResponse.json({
      documentName: payload.documentName,
      folderUrl,
      items,             // <- la UI usa data.items   
      totalImages: items.length
    });
  } catch (e: any) {
    console.error("[/api/liquidacion prep] error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Error interno (prep)" }, { status: 500 });
  } finally {
    if (tempFilePath) { try { await unlink(tempFilePath); } catch {} }
  }
}
