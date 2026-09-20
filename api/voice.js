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

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "GEMINI_API_KEY is not configured in Vercel."
      });
    }

    console.log("GEMINI TTS START", {
      characters: text.length
    });

    // Use one Gemini TTS request per narration so the Free Tier daily quota
    // is consumed once instead of once per chunk.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let response;

    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gemini-3.1-flash-tts-preview",
            input: text,
            response_format: {
              type: "audio"
            },
            generation_config: {
              speech_config: [
                {
                  voice: "Kore"
                }
              ]
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const result = await response.json();

    if (!response.ok) {
      const details =
        result?.error?.message ||
        result?.message ||
        "Gemini TTS API request failed.";

      throw new Error(details);
    }

    const audioItems = (result?.steps || [])
      .flatMap(step =>
        Array.isArray(step?.content) ? step.content : []
      )
      .filter(item => item?.type === "audio" && item?.data);

    if (!audioItems.length) {
      throw new Error("Gemini returned no audio.");
    }

    const mimeType =
      audioItems[0]?.mime_type ||
      "audio/l16; rate=24000; channels=1";

    const sampleRate =
      Number(audioItems[0]?.sample_rate) || 24000;

    const channels =
      Number(audioItems[0]?.channels) || 1;

    const combinedAudio = (() => {
      if (audioItems.length === 1) {
        return audioItems[0].data;
      }

      const decoded = audioItems.map(item => {
        const binary = Buffer.from(item.data, "base64");
        return new Uint8Array(
          binary.buffer,
          binary.byteOffset,
          binary.byteLength
        );
      });

      const totalBytes = decoded.reduce(
        (sum, bytes) => sum + bytes.length,
        0
      );

      const combined = new Uint8Array(totalBytes);
      let offset = 0;

      for (const bytes of decoded) {
        combined.set(bytes, offset);
        offset += bytes.length;
      }

      return Buffer.from(combined).toString("base64");
    })();

    console.log("GEMINI TTS AUDIO PARTS", {
      parts: audioItems.length,
      totalCharacters: text.length
    });

    console.log("GEMINI TTS SUCCESS", {
      characters: text.length,
      sampleRate,
      channels,
      mimeType
    });

    return res.status(200).json({
      ok: true,
      engine: "Gemini TTS",
      voice: "Kore",
      audio: combinedAudio,
      audioMimeType: mimeType,
      sampleRate,
      channels,
      type: audioItems[0]?.type || "audio"
    });

  } catch (error) {
    console.error("GEMINI TTS FAILURE:", error);

    const details =
      error?.name === "AbortError"
        ? "Gemini TTS request timed out."
        : error?.message || String(error);

    return res.status(502).json({
      ok: false,
      error: "Gemini TTS generation failed.",
      details
    });
  }
}
