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
            '  "linkCotizador": "string" // link a Alibaba o Amazon con producto similar',
            "}.",
            "Prioriza siempre resultados de Alibaba; si no se encuentra un producto específico, genera un link de búsqueda con las palabras clave del nombre comercial."
          ].join(" "),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Clasifica este producto según el sistema arancelario ecuatoriano y devuelve también un link de referencia (preferiblemente de Alibaba) con un producto similar." +
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

    // Fallback automático → genera link de búsqueda Alibaba si no se devolvió uno válido
    let link = data.linkCotizador || "";
    const cname = data.commercialName || commercialName || "";
    if (!link || !link.includes("alibaba.com")) {
      const q = cname.replace(/\s+/g, "+") || "product";
      link = `https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&SearchText=${q}`;
    }

    return NextResponse.json({
      hsCode: data.hsCode || "",
      commercialName: cname,
      normalizedName: data.normalizedName || "",
      suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [],
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      reason: data.reason || "",
      linkCotizador: link,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
