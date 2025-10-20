// app/api/proforma/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

// Permite configurar el ejecutable de Python por variable de entorno en Windows.
// Ej: set PYTHON_CMD=.venv\\Scripts\\python.exe
const PY_CMD = process.env.PYTHON_CMD || "python";

function runPython(pyPath: string, tmpPath: string, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(PY_CMD, [pyPath, tmpPath, contentType || ""], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      if (code === 0 && out.trim()) return resolve(out);
      const msg = `python(${PY_CMD}) exit=${code} ${err || "(sin stderr)"} ${out ? ` | out: ${out.slice(0,200)}` : ""}`;
      reject(new Error(msg));
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ meta:{}, columns:[], rows:[], warnings:["Falta 'file'"] }, { status: 200 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const tmpPath = path.join(os.tmpdir(), `${randomUUID()}-${file.name}`);
    await writeFile(tmpPath, new Uint8Array(arrayBuffer));

    const pyPath = path.join(process.cwd(), "scripts", "parser_proforma.py");
    try {
      // Asegura que el script exista (si no, devolver advertencia útil en vez de 500)
      await access(pyPath);
    } catch {
      return NextResponse.json({
        meta:{}, columns:[], rows:[],
        warnings:[`No se encontró parser_proforma.py en ${pyPath}`]
      }, { status: 200 });
    }

    try {
      const out = await runPython(pyPath, tmpPath, file.type || "");
      const json = JSON.parse(out);
      return NextResponse.json(json, { status: 200 });
    } catch (e:any) {
      // ⚠️ En lugar de 500, devolvemos 200 con 'warnings' para que el UI lo muestre bonito
      return NextResponse.json({
        meta:{}, columns:[], rows:[],
        warnings:[`Error en parser: ${e?.message || e}`]
      }, { status: 200 });
    }
  } catch (e:any) {
    return NextResponse.json({
      meta:{}, columns:[], rows:[],
      warnings:[`Fallo en /api/proforma: ${e?.message || e}`]
    }, { status: 200 });
  }
}
