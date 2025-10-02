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
          content: [
            "Eres un especialista en clasificación arancelaria (Ecuador / SENAE, NANDINA).",
            "Devuelve SOLO JSON con el esquema:",
            "{",
            '  "hsCode": "string",',
            '  "commercialName": "string",',
            '  "normalizedName": "string",',
            '  "suggestions": ["string","string","string"],',
            '  "confidence": 0-1,',
            '  "reason": "string",',
            '  "linkCotizador": "string" // link a Amazon, eBay o Alibaba con producto similar',
            "}"
          ].join(" "),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Clasifica este producto según el sistema arancelario ecuatoriano y devuelve también un link de referencia (Amazon, eBay o Alibaba) con un producto similar." +
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
      linkCotizador: data.linkCotizador || "", // 👈 nuevo campo
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
