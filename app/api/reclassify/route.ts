// app/api/reclassify/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    const { imageUrl, commercialName } = await req.json();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            [
              "Eres un especialista en clasificación arancelaria (Ecuador / SENAE, NANDINA).",
              "Devuelve SOLO JSON con el esquema:",
              "{",
              '  "hsCode": "string",',
              '  "commercialName": "string",            // nombre tal como vino (o el que consideres correcto si está vacío)',
              '  "normalizedName": "string",            // nombre COMERCIAL FORMAL en español (Ecuador), singular, sin marcas',
              '  "suggestions": ["string","string","string"], // hasta 3 nombres formales alternativos',
              '  "confidence": 0-1,',
              '  "reason": "string"',
              "}",
              "Normaliza términos coloquiales (p.ej., “parlante” → “altavoz”; “audífonos” → “auriculares”).",
              "Evita marcas y adjetivos de marketing; usa descriptores técnicos relevantes solo si se observan en la imagen (p. ej., 'Bluetooth', 'activo', 'portátil').",
            ].join(" ")
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Clasifica este producto según el sistema arancelario ecuatoriano y propone un nombre comercial formal." +
                (commercialName ? ` Nombre ingresado: ${commercialName}` : ""),
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });

    let data: any = {};
    try {
      data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {}

    return NextResponse.json({
      hsCode: data.hsCode || data.hs_code || "",
      commercialName: data.commercialName || data.commercial_name || commercialName || "",
      normalizedName: data.normalizedName || data.normalized_name || "",
      suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [],
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      reason: data.reason || "",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
