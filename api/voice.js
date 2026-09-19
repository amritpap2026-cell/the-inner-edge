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

    // Browser preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only POST
    if (req.method !== "POST") {
        return res.status(405).json({
            ok: false,
            error: "Method not allowed"
        });
    }

    try {
        // =========================
        // READ BODY
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
        // VALIDATE
        // =========================
        if (!text || typeof text !== "string") {
            return res.status(400).json({
                ok: false,
                error: "Text is required",
                receivedType: typeof text
            });
        }

        if (text.length > 12000) {
            return res.status(400).json({
                ok: false,
                error: "Text is too long. Maximum 12,000 characters."
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
        // CREATE STREAMING TTS
        // =========================
        const communicate = new Communicate(text, {
            voice,
            rate,
            volume,
            pitch,

            // Fail the connection instead of hanging
            // for several minutes.
            connectionTimeout: 10000
        });

        const subMaker = new SubMaker();

        const audioChunks = [];

        let audioBytes = 0;
        let wordCount = 0;

        // =========================
        // HARD SERVER TIMEOUT
        // =========================
        const startTime = Date.now();

        const MAX_TIME = 40000;

        for await (const chunk of communicate.stream()) {

            // Stop if generation takes too long.
            if (Date.now() - startTime > MAX_TIME) {
                throw new Error(
                    "Voice generation timed out after 40 seconds."
                );
            }

            // Audio chunk
            if (
                chunk.type === "audio" &&
                chunk.data
            ) {
                audioChunks.push(chunk.data);

                audioBytes += chunk.data.length;
            }

            // Word timing
            else if (
                chunk.type === "WordBoundary"
            ) {
                subMaker.feed(chunk);

                wordCount++;
            }
        }

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
        // COMBINE MP3
        // =========================
        const audioBuffer =
            Buffer.concat(audioChunks);

        const audioBase64 =
            audioBuffer.toString("base64");

        // =========================
        // CREATE SRT
        // =========================
        const srt =
            subMaker.getSrt();

        console.log(
            "Voice generation successful:",
            {
                audioBytes,
                chunks: audioChunks.length,
                words: wordCount
            }
        );

        // =========================
        // RETURN RESULT
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

        console.error(
            "Voice generation error:",
            error
        );

        const message =
            error?.message ||
            "Unknown voice generation error";

        // Timeout
        if (
            message
                .toLowerCase()
                .includes("timeout")
            ||
            message
                .toLowerCase()
                .includes("timed out")
        ) {
            return res.status(504).json({
                ok: false,
                error:
                    "Voice generation timed out",
                details: message
            });
        }

        // TTS connection error
        return res.status(502).json({
            ok: false,
            error:
                "Edge TTS connection failed",
            details: message
        });
    }
}
