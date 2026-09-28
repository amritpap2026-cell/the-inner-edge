// api/voice.js
// The Inner Edge — Multi-Engine Text-to-Speech Generation

export default async function handler(req, res) {

    // =========================
    // CORS Headers
    // =========================

    const allowedOrigins = [
        "https://the-inner-edge.vercel.app",
        "https://amritpap2026-cell.github.io"
    ];

    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");

    // Handle preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only POST allowed
    if (req.method !== "POST") {
        return res.status(405).json({
            ok: false,
            error: "Method not allowed"
        });
    }

    try {

        // =========================
        // 1. Read request body
        // =========================

        const body = typeof req.body === "string"
            ? JSON.parse(req.body)
            : (req.body || {});

        const text = String(body.text || "").trim();
        const voice = String(body.voice || "en-US-GuyNeural");
        const profile = String(body.profile || "Professional Male");
        const requestedEngine = String(body.engine || "auto").toLowerCase();

        if (!text) {
            return res.status(400).json({
                ok: false,
                error: "Text is required."
            });
        }

        // =========================
        // 2. Determine engine priority order
        // =========================

        const engines = buildEnginePriority(requestedEngine);

        let lastError = null;

        // Try each engine in order
        for (const engine of engines) {

            try {

                let result = null;

                switch (engine) {

                    case "edge":
                        result = await generateWithEdgeTTS(text, voice);
                        break;

                    case "google":
                        result = await generateWithGoogleTTS(text, voice);
                        break;

                    case "elevenlabs":
                        result = await generateWithElevenLabs(text, voice);
                        break;

                    case "azure":
                        result = await generateWithAzureTTS(text, voice);
                        break;

                    default:
                        throw new Error(`Unsupported engine: ${engine}`);
                }

                if (result && result.audio) {

                    return res.status(200).json({
                        ok: true,
                        engine: result.engine,
                        audioFormat: result.audioFormat,
                        mimeType: result.mimeType,
                        sampleRate: result.sampleRate,
                        channels: result.channels,
                        audio: result.audio
                    });
                }

            } catch (engineError) {

                console.warn(`TTS engine "${engine}" failed:`, engineError.message);

                lastError = engineError;

                // Continue to the next engine
                continue;
            }
        }

        // =========================
        // 3. All engines failed
        // =========================

        console.error("All TTS engines failed. Last error:", lastError);

        return res.status(503).json({
            ok: false,
            error: "Voice generation is temporarily unavailable.",
            details: lastError?.message || "No TTS engine could generate audio."
        });

    } catch (error) {

        console.error("Voice endpoint error:", error);

        return res.status(500).json({
            ok: false,
            error: "Voice generation failed.",
            details: error.message
        });
    }
}


/* =========================================================
   ENGINE PRIORITY
========================================================= */

/**
 * Builds the ordered list of TTS engines to try based on the
 * user's requested engine and which API keys are available.
 */
function buildEnginePriority(requestedEngine) {

    // If a specific engine is requested (not "auto"), try it first,
    // then fall back to others.
    if (requestedEngine !== "auto" && requestedEngine !== "local") {

        const fallbackOrder = ["edge", "google", "elevenlabs", "azure"];

        // Put the requested engine first, then the rest
        const ordered = [requestedEngine];

        fallbackOrder.forEach(engine => {
            if (engine !== requestedEngine && ordered.indexOf(engine) === -1) {
                ordered.push(engine);
            }
        });

        return ordered.filter(engine => isEngineAvailable(engine));
    }

    // Auto mode: try engines in a sensible order
    // Edge TTS first (free, no API key needed), then paid engines.
    const autoOrder = ["edge", "google", "elevenlabs", "azure"];

    return autoOrder.filter(engine => isEngineAvailable(engine));
}

/**
 * Checks whether a TTS engine is available based on environment variables.
 */
function isEngineAvailable(engine) {

    switch (engine) {

        case "edge":
            // Edge TTS needs no API key
            return true;

        case "google":
            return Boolean(process.env.GOOGLE_TTS_API_KEY);

        case "elevenlabs":
            return Boolean(process.env.ELEVENLABS_API_KEY);

        case "azure":
            return Boolean(
                process.env.AZURE_SPEECH_KEY &&
                process.env.AZURE_SPEECH_REGION
            );

        default:
            return false;
    }
}


/* =========================================================
   EDGE TTS (Free, No API Key)
========================================================= */

/**
 * Generates audio using Microsoft Edge's online TTS service.
 * This is the primary engine because it requires no API key.
 */
async function generateWithEdgeTTS(text, voiceName) {

    // Map friendly voice names to Edge TTS voice identifiers
    const voiceMap = {
        "en-US-GuyNeural": "en-US-GuyNeural",
        "en-US-JennyNeural": "en-US-JennyNeural",
        "en-US-AriaNeural": "en-US-AriaNeural",
        "en-US-DavisNeural": "en-US-DavisNeural",
        "en-GB-RyanNeural": "en-GB-RyanNeural",
        "en-GB-SoniaNeural": "en-GB-SoniaNeural"
    };

    const resolvedVoice = voiceMap[voiceName] || "en-US-GuyNeural";

    // Edge TTS endpoint
    const edgeTtsUrl = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

    // Build SSML for Edge TTS
    const ssml = [
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>",
        `<voice name='${resolvedVoice}'>`,
        escapeXml(text),
        "</voice>",
        "</speak>"
    ].join("");

    const response = await fetch(edgeTtsUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: ssml
    });

    if (!response.ok) {
        throw new Error(`Edge TTS returned ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = arrayBufferToBase64(arrayBuffer);

    return {
        engine: "Edge TTS",
        audioFormat: "mp3",
        mimeType: "audio/mpeg",
        sampleRate: 16000,
        channels: 1,
        audio: base64Audio
    };
}


/* =========================================================
   GOOGLE CLOUD TTS
========================================================= */

/**
 * Generates audio using Google Cloud Text-to-Speech REST API.
 * Requires GOOGLE_TTS_API_KEY environment variable.
 */
async function generateWithGoogleTTS(text, voiceName) {

    const apiKey = process.env.GOOGLE_TTS_API_KEY;

    if (!apiKey) {
        throw new Error("GOOGLE_TTS_API_KEY is not configured.");
    }

    // Map friendly names to Google voice names
    const googleVoiceMap = {
        "en-US-GuyNeural": "en-US-Neural2-D",
        "en-US-JennyNeural": "en-US-Neural2-F",
        "en-US-AriaNeural": "en-US-Neural2-F",
        "en-US-DavisNeural": "en-US-Neural2-D",
        "en-GB-RyanNeural": "en-GB-Neural2-B",
        "en-GB-SoniaNeural": "en-GB-Neural2-A"
    };

    const resolvedVoice = googleVoiceMap[voiceName] || "en-US-Neural2-D";

    // Extract language code from voice name
    const languageCode = resolvedVoice.substring(0, 5);

    const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                input: {
                    text: text
                },
                voice: {
                    languageCode: languageCode,
                    name: resolvedVoice
                },
                audioConfig: {
                    audioEncoding: "MP3",
                    speakingRate: 1.0,
                    pitch: 0.0
                }
            })
        }
    );

    const data = await response.json();

    if (!response.ok || !data.audioContent) {
        throw new Error(data.error?.message || "Google TTS returned no audio.");
    }

    return {
        engine: "Google Cloud TTS",
        audioFormat: "mp3",
        mimeType: "audio/mpeg",
        sampleRate: 24000,
        channels: 1,
        audio: data.audioContent
    };
}


/* =========================================================
   ELEVENLABS
========================================================= */

/**
 * Generates audio using ElevenLabs API.
 * Requires ELEVENLABS_API_KEY environment variable.
 *
 * Note: as of 2026, eleven_monolingual_v1 and eleven_multilingual_v1
 * are deprecated. We use eleven_multilingual_v2 for best quality.
 */
async function generateWithElevenLabs(text, voiceName) {

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
        throw new Error("ELEVENLABS_API_KEY is not configured.");
    }

    // Map friendly names to ElevenLabs voice IDs
    // These are public voice IDs from ElevenLabs' voice library.
    const elevenLabsVoiceMap = {
        "en-US-GuyNeural": "pNInz6obpgDQGcFmaJgB",    // Adam
        "en-US-JennyNeural": "21m00Tcm4TlvDq8ikWAM",  // Rachel
        "en-US-AriaNeural": "EXAVITQu4vr4xnSDxMaL",   // Bella
        "en-US-DavisNeural": "yoZ06aMxZJJ28mfd3POQ",  // Sam
        "en-GB-RyanNeural": "onwK4e9ZLuTAKqWW03F9",   // Daniel
        "en-GB-SoniaNeural": "ThT5KcBeYPX3keUQqHPh"   // Dorothy
    };

    const voiceId = elevenLabsVoiceMap[voiceName] || "pNInz6obpgDQGcFmaJgB";

    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
            method: "POST",
            headers: {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": apiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                }
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`ElevenLabs returned ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = arrayBufferToBase64(arrayBuffer);

    return {
        engine: "ElevenLabs",
        audioFormat: "mp3",
        mimeType: "audio/mpeg",
        sampleRate: 44100,
        channels: 1,
        audio: base64Audio
    };
}


/* =========================================================
   AZURE SPEECH
========================================================= */

/**
 * Generates audio using Azure Cognitive Services Speech.
 * Requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.
 */
async function generateWithAzureTTS(text, voiceName) {

    const apiKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    if (!apiKey || !region) {
        throw new Error("Azure Speech credentials are not configured.");
    }

    // Map friendly names to Azure voice names
    const azureVoiceMap = {
        "en-US-GuyNeural": "en-US-GuyNeural",
        "en-US-JennyNeural": "en-US-JennyNeural",
        "en-US-AriaNeural": "en-US-AriaNeural",
        "en-US-DavisNeural": "en-US-DavisNeural",
        "en-GB-RyanNeural": "en-GB-RyanNeural",
        "en-GB-SoniaNeural": "en-GB-SoniaNeural"
    };

    const resolvedVoice = azureVoiceMap[voiceName] || "en-US-GuyNeural";

    // Build SSML for Azure
    const ssml = [
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>",
        `<voice name='${resolvedVoice}'>`,
        escapeXml(text),
        "</voice>",
        "</speak>"
    ].join("");

    const response = await fetch(
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": apiKey,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "TheInnerEdge"
            },
            body: ssml
        }
    );

    if (!response.ok) {
        throw new Error(`Azure TTS returned ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = arrayBufferToBase64(arrayBuffer);

    return {
        engine: "Azure Speech",
        audioFormat: "mp3",
        mimeType: "audio/mpeg",
        sampleRate: 24000,
        channels: 1,
        audio: base64Audio
    };
}


/* =========================================================
   UTILITY FUNCTIONS
========================================================= */

/**
 * Converts an ArrayBuffer to a base64 string.
 */
function arrayBufferToBase64(buffer) {

    // In Node.js / Vercel serverless environment
    if (typeof Buffer !== "undefined") {
        return Buffer.from(buffer).toString("base64");
    }

    // Fallback for browser environments
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

/**
 * Escapes special XML characters for SSML.
 */
function escapeXml(text) {

    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
