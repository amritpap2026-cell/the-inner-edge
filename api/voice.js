export default async function handler(req, res) {
    // CORS
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

    // Handle browser preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only POST is allowed
    if (req.method !== "POST") {
        return res.status(405).json({
            ok: false,
            error: "Method not allowed"
        });
    }

    try {
        const {
            text,
            voice = "en-US-GuyNeural",
            rate = "+0%",
            volume = "+0%",
            pitch = "+0Hz"
        } = req.body || {};

        // Validate text
        if (!text || typeof text !== "string") {
            return res.status(400).json({
                ok: false,
                error: "Text is required"
            });
        }

        // Prevent accidentally huge requests
        if (text.length > 12000) {
            return res.status(400).json({
                ok: false,
                error: "Text is too long. Maximum 12,000 characters."
            });
        }

        // Load Edge TTS
        const {
            EdgeTTS,
            createSRT
        } = await import("@travisvn/edge-tts");

        // Create TTS engine
        const tts = new EdgeTTS(
            text,
            voice,
            {
                rate,
                volume,
                pitch
            }
        );

        // Generate audio + word timing
        const result = await tts.synthesize();

        // Convert MP3 Blob to base64
        const audioBuffer = Buffer.from(
            await result.audio.arrayBuffer()
        );

        const audioBase64 = audioBuffer.toString("base64");

        // Generate SRT subtitles
        const srt = createSRT(result.subtitle);

        return res.status(200).json({
            ok: true,
            engine: "Edge TTS",
            voice,
            audio: audioBase64,
            audioMimeType: "audio/mpeg",
            subtitles: srt,
            subtitleFormat: "srt",
            size: audioBuffer.length
        });

    } catch (error) {
        console.error("Voice generation error:", error);

        return res.status(500).json({
            ok: false,
            error: "Voice generation failed",
            details: error?.message || "Unknown error"
        });
    }
}
