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

async function executePythonScript(scriptName: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const pythonExe = process.env.PYTHON_PATH || "python";
    const scriptPath = join(process.cwd(), "scripts", scriptName);

    const child = spawn(pythonExe, [scriptPath, ...args], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Python script failed (code ${code}): ${stderr || stdout}`));
    });
  });
}

/**
 * Como nuestro script Python ahora deja SOLO el JSON en stdout,
 * esto es un simple JSON.parse con fallback prudente.
 */
function parseJsonOrThrow(s: string): any {
  // recorta BOM / espacios
  const t = s.trim().replace(/^\uFEFF/, "");
  return JSON.parse(t);
}

/* ----------------------- Handler ----------------------- */

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: "API Key de OpenAI no configurada" }, { status: 500 });
    }

    const folderId = extractFolderId(folderUrl);
    if (!folderId) {
      return NextResponse.json({ error: "URL/ID de carpeta de Google Drive inválida" }, { status: 400 });
    }

    // Guardar el PDF temporalmente
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    tempFilePath = join(tmpdir(), `upload_${Date.now()}_${(file as any).name || "file.pdf"}`);
    await writeFile(tempFilePath, buffer);

    console.log(`[API] Archivo PDF guardado: ${tempFilePath}`);
    console.log(`[API] Procesando liquidación completa para: ${docName}`);

    // Ejecutar Python
    const { stdout, stderr } = await executePythonScript("liquidacion_completa.py", [
      tempFilePath,
      docName,
      folderId,
      process.env.OPENAI_API_KEY!,
    ]);

    if (stderr) {
      // Solo para depuración; no impide parsear
      console.error("[PY STDERR]", stderr);
    }

    // stdout DEBE SER el JSON limpio
    let processResult: any;
    try {
      processResult = parseJsonOrThrow(stdout);
    } catch {
      console.error("Error parsing Python script result. STDOUT:", stdout);
      throw new Error("Error al procesar resultado del script Python");
    }

    if (!processResult?.success) {
      throw new Error(processResult?.error || "Error desconocido en el procesamiento");
    }

    const response = {
      totalImages: processResult.total_images,
      sheetUrl: processResult.sheet_url,
      driveFolder: processResult.folder_url,
      classifications: (processResult.image_data || []).map((item: any) => ({
        imageUrl: item.url,
        imageName: item.name,
        hsCode: item.classification?.hs_code || "",
        commercialName: item.classification?.commercial_name || "",
        confidence: item.classification?.confidence ?? 0,
        reason: item.classification?.reason || "",
      })),
    };

    console.log(`[API] Procesamiento completado`);
    console.log(`[API] Total imágenes: ${response.totalImages}`);
    console.log(`[API] Google Sheet: ${response.sheetUrl}`);

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Error en API de liquidación:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Error interno del servidor" }, { status: 500 });
  } finally {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log(`[API] Archivo temporal eliminado: ${tempFilePath}`);
      } catch (e) {
        console.warn(`[API] No se pudo eliminar archivo temporal: ${e}`);
      }
    }
  }
}
