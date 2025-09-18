import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function asImageContent(input: { imageUrl?: string; imageB64?: string }) {
  if (input.imageB64) {
    const b64 = input.imageB64.startsWith("data:")
      ? input.imageB64
      : `data:image/png;base64,${input.imageB64}`;
    return { type: "image_url" as const, image_url: { url: b64 } };
  }
  if (input.imageUrl) {
    return { type: "image_url" as const, image_url: { url: input.imageUrl } };
  }
  throw new Error("Falta imageUrl o imageB64");
}

export async function POST(req: Request) {
  try {
    const { imageUrl, imageB64, commercialName } = await req.json();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Eres un especialista en clasificación arancelaria (Ecuador / SENAE, NANDINA). Devuelve SOLO JSON {"hsCode":"xxxxxx","commercialName":"texto","confidence":0-1,"reason":"texto"}.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Clasifica este producto. ${commercialName ? "Nombre comercial: " + commercialName : ""}` },
            asImageContent({ imageUrl, imageB64 }),
          ],
        },
      ],
    });

    const data = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return NextResponse.json({
      hsCode: data.hsCode || data.hs_code || "",
      commercialName: data.commercialName || data.commercial_name || commercialName || "",
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      reason: data.reason || "",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
