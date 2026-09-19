import { EdgeTTS, createSRT } from "@travisvn/edge-tts";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const text = String(body.text || "").trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Missing text."
      });
    }

    if (text.length > 12000) {
      return res.status(400).json({
        ok: false,
        error: "Text is too long. Maximum is 12,000 characters."
      });
    }

    const voice = body.voice || "en-US-GuyNeural";

    console.log("EDGE TTS START", {
      voice,
      characters: text.length
    });

    const tts = new EdgeTTS(text, voice);

    console.log("EDGE TTS OBJECT CREATED");
    console.log("EDGE TTS SYNTHESIS STARTING");

    const result = await tts.synthesize();

    console.log("EDGE TTS SYNTHESIS FINISHED");

    if (!result || !result.audio) {
      throw new Error("Edge TTS returned no audio.");
    }

    const audioBuffer = Buffer.from(
      await result.audio.arrayBuffer()
    );

    if (!audioBuffer.length) {
      throw new Error("Edge TTS returned empty audio.");
    }

    const subtitles = createSRT(result.subtitle || []);

    console.log("EDGE TTS SUCCESS", {
      bytes: audioBuffer.length,
      words: result.subtitle?.length || 0
    });

    return res.status(200).json({
      ok: true,
      engine: "Microsoft Edge TTS",
      voice,
      audio: audioBuffer.toString("base64"),
      audioMimeType: "audio/mpeg",
      subtitles,
      subtitleFormat: "srt",
      size: audioBuffer.length,
      words: result.subtitle?.length || 0
    });

  } catch (error) {
    console.error("EDGE TTS FAILURE:", error);

    return res.status(502).json({
      ok: false,
      engine: "Microsoft Edge TTS",
      error: "Edge TTS generation failed.",
      details: error?.message || String(error)
    });
  }
}
