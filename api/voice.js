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

    /*
      Long Gemini TTS requests can return only a short initial audio segment.
      Split longer narration into small sentence-aware chunks and synthesize
      each chunk separately, then concatenate the PCM data below. This keeps
      long narration complete on both mobile and desktop.
    */
    function splitTextForTTS(value, maxChars = 420) {
      const sentences = String(value)
        .replace(/\s+/g, " ")
        .trim()
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean);

      const chunks = [];
      let current = "";

      for (const sentence of sentences) {
        if (!current) {
          current = sentence;
          continue;
        }

        if ((current + " " + sentence).length <= maxChars) {
          current += " " + sentence;
        } else {
          chunks.push(current);
          current = sentence;
        }
      }

      if (current) chunks.push(current);

      const finalChunks = [];
      for (const chunk of chunks) {
        if (chunk.length <= maxChars) {
          finalChunks.push(chunk);
          continue;
        }

        for (let i = 0; i < chunk.length; i += maxChars) {
          finalChunks.push(chunk.slice(i, i + maxChars).trim());
        }
      }

      return finalChunks.filter(Boolean);
    }

    const textChunks = splitTextForTTS(text);
    
    console.log("GEMINI TTS CHUNKS", {
      chunks: textChunks.length,
      characters: text.length
    });

    /*
      Generate chunks in parallel. Sequential generation can exceed Vercel's
      function lifetime for longer scripts even though each Gemini request is
      fast. The returned PCM chunks are joined in their original text order.
    */
    const chunkResults = await Promise.all(
      textChunks.map(async (chunk, index) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        try {
          const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            {
              method: "POST",
              headers: {
                "x-goog-api-key": apiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gemini-3.1-flash-tts-preview",
                input: chunk,
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

          const result = await response.json();

          if (!response.ok) {
            const details =
              result?.error?.message ||
              result?.message ||
              "Gemini TTS API request failed.";

            throw new Error(
              "Chunk " + (index + 1) + "/" + textChunks.length + ": " + details
            );
          }

          const items = (result?.steps || [])
            .flatMap(step =>
              Array.isArray(step?.content) ? step.content : []
            )
            .filter(item => item?.type === "audio" && item?.data);

          if (!items.length) {
            throw new Error(
              "Chunk " + (index + 1) + "/" + textChunks.length +
              ": Gemini returned no audio."
            );
          }

          console.log("GEMINI TTS CHUNK SUCCESS", {
            chunk: index + 1,
            totalChunks: textChunks.length,
            characters: chunk.length,
            audioParts: items.length
          });

          return {
            index,
            items
          };
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    chunkResults.sort((a, b) => a.index - b.index);

    const audioItems = chunkResults.flatMap(item => item.items);


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
