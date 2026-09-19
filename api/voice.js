import { EdgeTTS, createSRT } from "@travisvn/edge-tts";

export default async function handler(req, res) {
  // CORS
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
        error: "Text is too long. Maximum is 12,000 characters per request."
      });
    }

    const voice = body.voice || "en-US-GuyNeural";

    // Edge TTS 1.0.2 expects rate/volume/pitch
    // in the format accepted by its Communicate configuration.
    // Use the package defaults by omitting these options.
    console.log("Edge TTS request:", {
      voice,
      characters: text.length
    });

    const tts = new EdgeTTS(text, voice);

    const result = await Promise.race([
      tts.synthesize(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Edge TTS request timed out.")),
          55000
        )
      )
    ]);

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

    console.log("Edge TTS success:", {
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
    console.error("EDGE TTS ERROR:", error);

    const message =
      error?.message ||
      String(error) ||
      "Unknown Edge TTS error";

    return res.status(502).json({
      ok: false,
      engine: "Microsoft Edge TTS",
      error: "Edge TTS generation failed.",
      details: message
    });
  }
}
