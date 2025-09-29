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
  if (/^[a-zA-Z0-9_-]{10,}$/.test(folderUrl)) return folderUrl; // ya es ID
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

/** Intenta parsear JSON tolerando logs en stdout. */
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

// ---------- Fase COMMIT (JSON) ----------
if (contentType.includes("application/json")) {
  let tmpPayloadPath: string | null = null;
  try {
    const body = await request.json();
    if (body?.action !== "commit") {
      return NextResponse.json({ error: "Acción inválida. Usa action='commit'." }, { status: 400 });
    }
    if (!body?.documentName || !body?.folderUrl || !Array.isArray(body?.items)) {
      return NextResponse.json({ error: "Payload inválido (documentName, folderUrl, items)" }, { status: 400 });
    }

    const folderId = extractFolderId(body.folderUrl);
    if (!folderId) {
      return NextResponse.json({ error: "URL/ID de carpeta Google Drive inválida" }, { status: 400 });
    }

    // 🔴 Normalizamos los items para el script: incluimos sí o sí b64/_b64
    const itemsForPy = body.items.map((it: any, idx: number) => {
      const name = it?.name || `image_${String(idx + 1).padStart(3, "0")}.png`;
      let b64: string | null = it?._b64 || it?.b64 || null;
      if (!b64 && typeof it?.url === "string" && it.url.startsWith("data:image")) {
        const parts = it.url.split(",", 1);
        b64 = it.url.slice(parts[0].length + 1); // después de la primera coma
      }
      return {
        name,
        b64, // lo usará el script para subir a Drive
        hs_code: it?.hs_code ?? it?.hsCode ?? it?.classification?.hs_code ?? "",
        commercial_name: it?.commercial_name ?? it?.commercialName ?? it?.classification?.commercial_name ?? "",
        confidence: it?.confidence ?? it?.classification?.confidence ?? "",
        reason: it?.reason ?? it?.classification?.reason ?? "",
      };
    });

    const payload = { documentName: body.documentName, folderId, items: itemsForPy };
    tmpPayloadPath = join(tmpdir(), `commit_${Date.now()}.json`);
    await writeFile(tmpPayloadPath, JSON.stringify(payload), "utf-8");

    const { stdout, stderr, code } = await runPy("commit_liquidacion.py", [tmpPayloadPath]);
    if (stderr) console.error("[commit_liquidacion stderr]", stderr);
    if (code !== 0) {
      console.error("[commit_liquidacion stdout]", stdout);
      throw new Error(`commit_liquidacion.py exit code ${code}`);
    }

    const out = parseJsonLoose(stdout);
    if (!out?.success) throw new Error(out?.error || "Commit fallido");

    return NextResponse.json({
      success: true,
      sheetUrl: out.sheetUrl,
      driveFolder: out.driveFolder,
      total: out.total,
      rows: out.rows,
    });
  } catch (e: any) {
    console.error("[/api/liquidacion commit] error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Error interno (commit)" }, { status: 500 });
  } finally {
    if (tmpPayloadPath) { try { await unlink(tmpPayloadPath); } catch {} }
  }
}

  // ---------- Fase PREP (multipart/form-data) ----------
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

    // Guardar PDF temporal
    const bytes = await file.arrayBuffer();
    tempFilePath = join(tmpdir(), `upload_${Date.now()}_${(file as any).name || "file.pdf"}`);
    await writeFile(tempFilePath, Buffer.from(bytes));

    // Ejecuta PREP (extraer + clasificar base64)
    const { stdout, stderr, code } = await runPy("prep_liquidacion.py", [
      tempFilePath,
      docName,
      process.env.OPENAI_API_KEY!,
    ]);

    if (stderr) console.error("[prep_liquidacion stderr]", stderr);
    if (code !== 0) {
      console.error("[prep_liquidacion stdout]", stdout);
      throw new Error(`prep_liquidacion.py exit code ${code}`);
    }

    const payload = parseJsonLoose(stdout);
    if (!payload?.success) throw new Error(payload?.error || "Fallo en preparación");

    const images = (payload.images || []).map((img: any, i: number) => ({
      id: img.id || `img${i + 1}`,
      url: `data:image/png;base64,${img.b64}`, // preview para UI
      name: img.name || `image_${String(i + 1).padStart(3, "0")}.png`,
      hsCode: img.hs_code || "",
      commercialName: img.commercial_name || "",
      confidence: typeof img.confidence === "number" ? img.confidence : null,
      reason: img.reason || "",
      _b64: img.b64, // base64 sin subir a Drive
    }));

    return NextResponse.json({
      documentName: payload.documentName,
      folderUrl, // se reutiliza en el commit
      totalImages: images.length,
      images,
    });
  } catch (e: any) {
    console.error("[/api/liquidacion prep] error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Error interno (prep)" }, { status: 500 });
  } finally {
    if (tempFilePath) { try { await unlink(tempFilePath); } catch {} }
  }
}
