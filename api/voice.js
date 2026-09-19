export default async function handler(req, res) {
  // =========================
  // CORS
  // =========================
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://amritpap2026-cell.github.io"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // =========================
  // PREFLIGHT
  // =========================
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // =========================
  // ONLY POST
  // =========================
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    // =========================
    // READ REQUEST BODY
    // =========================
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON body"
        });
      }
    }

    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8"));
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON body"
        });
      }
    }

    body = body || {};

    // =========================
    // INPUTS
    // =========================
    const text = body.text;

    const voice =
      body.voice ||
      "en-US-GuyNeural";

    const rate =
      body.rate ||
      "+0%";

    const volume =
      body.volume ||
      "+0%";

    const pitch =
      body.pitch ||
      "+0Hz";

    // =========================
    // VALIDATE TEXT
    // =========================
    if (
      !text ||
      typeof text !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Text is required",
        receivedType: typeof text
      });
    }

    if (text.length > 12000) {
      return res.status(400).json({
        ok: false,
        error:
          "Text is too long. Maximum 12,000 characters."
      });
    }

    console.log("Voice request:", {
      characters: text.length,
      voice,
      rate,
      volume,
      pitch
    });

    // =========================
    // LOAD EDGE TTS
    // =========================
    const {
      Communicate,
      SubMaker
    } = await import("@travisvn/edge-tts");

    // =========================
    // CREATE TTS
    // =========================
    const communicate = new Communicate(text, {
      voice,
      rate,
      volume,
      pitch
    });

    const subMaker = new SubMaker();

    const audioChunks = [];

    let audioBytes = 0;
    let wordCount = 0;

    // =========================
    // STREAM TTS
    // =========================
    const streamPromise = (async () => {
      for await (
        const chunk of communicate.stream()
      ) {
        // -------------------------
        // AUDIO
        // -------------------------
        if (
          chunk &&
          chunk.type === "audio" &&
          chunk.data
        ) {
          audioChunks.push(chunk.data);

          audioBytes +=
            chunk.data.length;
        }

        // -------------------------
        // WORD TIMING
        // -------------------------
        else if (
          chunk &&
          chunk.type === "WordBoundary"
        ) {
          try {
            subMaker.feed(chunk);
            wordCount++;
          } catch (subtitleError) {
            console.warn(
              "Subtitle timing error:",
              subtitleError
            );
          }
        }
      }

      return true;
    })();

    // =========================
    // HARD TIMEOUT
    // =========================
    const timeoutPromise =
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              "Voice generation timed out after 40 seconds."
            )
          );
        }, 40000);
      });

    await Promise.race([
      streamPromise,
      timeoutPromise
    ]);

    // =========================
    // CHECK AUDIO
    // =========================
    if (
      audioChunks.length === 0 ||
      audioBytes === 0
    ) {
      throw new Error(
        "No audio was received from Edge TTS."
      );
    }

    // =========================
    // COMBINE AUDIO
    // =========================
    const audioBuffer =
      Buffer.concat(audioChunks);

    if (!audioBuffer.length) {
      throw new Error(
        "Generated audio is empty."
      );
    }

    // =========================
    // BASE64
    // =========================
    const audioBase64 =
      audioBuffer.toString("base64");

    // =========================
    // SRT
    // =========================
    let srt = "";

    try {
      srt = subMaker.getSrt();
    } catch (subtitleError) {
      console.warn(
        "SRT generation failed:",
        subtitleError
      );
    }

    // =========================
    // SUCCESS LOG
    // =========================
    console.log(
      "Voice generation successful:",
      {
        audioBytes,
        chunks: audioChunks.length,
        words: wordCount
      }
    );

    // =========================
    // RESPONSE
    // =========================
    return res.status(200).json({
      ok: true,

      engine: "Edge TTS",

      voice,

      audio: audioBase64,

      audioMimeType:
        "audio/mpeg",

      subtitles: srt,

      subtitleFormat: "srt",

      size: audioBuffer.length,

      chunks:
        audioChunks.length,

      words:
        wordCount
    });

  } catch (error) {
    // =========================
    // ERROR
    // =========================
    console.error(
      "Voice generation error:",
      error
    );

    const message =
      error?.message ||
      "Unknown voice generation error";

    const lowerMessage =
      message.toLowerCase();

    // =========================
    // TIMEOUT
    // =========================
    if (
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out")
    ) {
      return res.status(504).json({
        ok: false,
        error:
          "Voice generation timed out",
        details: message
      });
    }

    // =========================
    // TTS / CONNECTION ERROR
    // =========================
    return res.status(502).json({
      ok: false,
      error:
        "Edge TTS connection failed",
      details: message
    });
  }
}
