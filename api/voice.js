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
    const requestedEngine = String(body.engine || "auto").toLowerCase();
    const requestedVoice = String(body.voice || "en-US-GuyNeural");

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

    const allowed = new Set([
      "auto",
      "azure",
      "google",
      "edge",
      "elevenlabs",
      "gemini",
      "local"
    ]);

    const engine =
      allowed.has(requestedEngine)
        ? requestedEngine
        : "auto";

    const profileToAzureVoice = {
      "professional-male": "en-US-GuyNeural",
      "professional-female": "en-US-JennyNeural",
      "calm-documentary": "en-US-AriaNeural",
      "energetic-narrator": "en-US-DavisNeural"
    };

    const profileToGoogleVoice = {
      "professional-male": "en-US-Neural2-D",
      "professional-female": "en-US-Neural2-F",
      "calm-documentary": "en-US-Neural2-J",
      "energetic-narrator": "en-US-Neural2-A"
    };

    async function azureTTS() {
      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;

      if (!key || !region) {
        throw new Error("Azure Speech is not configured.");
      }

      const voice =
        profileToAzureVoice[String(body.profile || "").toLowerCase()] ||
        requestedVoice ||
        "en-US-GuyNeural";

      const endpoint =
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      const ssml =
        `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${escaped}</voice></speak>`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
          "User-Agent": "The-Inner-Edge"
        },
        body: ssml
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Azure Speech ${response.status}: ${details.slice(0, 500)}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (!bytes.length) {
        throw new Error("Azure returned empty audio.");
      }

      return {
        engine: "Microsoft Azure Speech",
        voice,
        audio: bytes.toString("base64"),
        sampleRate: 24000,
        channels: 1
      };
    }

    async function googleTTS() {
      const key = process.env.GOOGLE_TTS_API_KEY;

      if (!key) {
        throw new Error("Google Cloud TTS is not configured.");
      }

      const voice =
        profileToGoogleVoice[String(body.profile || "").toLowerCase()] ||
        "en-US-Neural2-D";

      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode: "en-US",
              name: voice
            },
            audioConfig: {
              audioEncoding: "LINEAR16",
              sampleRateHertz: 24000
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error?.message ||
          `Google Cloud TTS ${response.status}`
        );
      }

      if (!result?.audioContent) {
        throw new Error("Google Cloud TTS returned no audio.");
      }

      return {
        engine: "Google Cloud TTS",
        voice,
        audio: result.audioContent,
        sampleRate: 24000,
        channels: 1
      };
    }

    async function elevenLabsTTS() {
      const key = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;

      if (!key || !voiceId) {
        throw new Error("ElevenLabs is not configured.");
      }

      // Use MP3 for browser playback. Raw PCM is intended for audio pipelines;
      // MP3 is much more reliable across Android browsers and long narrations.
      const endpoint =
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2"
        })
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`ElevenLabs ${response.status}: ${details.slice(0, 500)}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (!bytes.length) {
        throw new Error("ElevenLabs returned empty audio.");
      }

      return {
        engine: "ElevenLabs",
        voice: voiceId,
        audio: bytes.toString("base64"),
        audioFormat: "mp3",
        mimeType: "audio/mpeg",
        sampleRate: 44100,
        channels: 2
      };
    }

    async function remotePCM(endpoint, label) {
      if (!endpoint) {
        throw new Error(`${label} is not configured.`);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          voice: requestedVoice,
          profile: body.profile || "professional-male"
        })
      });

      const contentType = response.headers.get("content-type") || "";

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`${label} ${response.status}: ${details.slice(0, 500)}`);
      }

      if (contentType.includes("application/json")) {
        const result = await response.json();
        const audio = result?.audio || result?.audioContent || result?.data;

        if (!audio) {
          throw new Error(`${label} returned no audio.`);
        }

        return {
          engine: label,
          voice: result?.voice || requestedVoice,
          audio,
          sampleRate: Number(result?.sampleRate || 24000),
          channels: Number(result?.channels || 1)
        };
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (!bytes.length) {
        throw new Error(`${label} returned empty audio.`);
      }

      return {
        engine: label,
        voice: requestedVoice,
        audio: bytes.toString("base64"),
        sampleRate: 24000,
        channels: 1
      };
    }

    async function geminiTTS() {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error("Gemini TTS is not configured.");
      }

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
              response_format: { type: "audio" },
              generation_config: {
                speech_config: [{ voice: "Kore" }]
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
        throw new Error(
          result?.error?.message ||
          result?.message ||
          "Gemini TTS API request failed."
        );
      }

      const audioItems = (result?.steps || [])
        .flatMap(step =>
          Array.isArray(step?.content) ? step.content : []
        )
        .filter(item => item?.type === "audio" && item?.data);

      if (!audioItems.length) {
        throw new Error("Gemini returned no audio.");
      }

      const decoded = audioItems.map(item =>
        new Uint8Array(
          Buffer.from(item.data, "base64")
        )
      );

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

      return {
        engine: "Gemini TTS",
        voice: "Kore",
        audio: Buffer.from(combined).toString("base64"),
        sampleRate: Number(audioItems[0]?.sample_rate) || 24000,
        channels: Number(audioItems[0]?.channels) || 1
      };
    }

    const providers = {
      azure: azureTTS,
      google: googleTTS,
      edge: () =>
        remotePCM(process.env.EDGE_TTS_ENDPOINT, "Edge TTS / Docker"),
      elevenlabs: elevenLabsTTS,
      gemini: geminiTTS,
      local: () =>
        remotePCM(process.env.LOCAL_TTS_ENDPOINT, "Local / Docker TTS")
    };

    // Production fallback order:
    // 1) ElevenLabs is the primary verified provider.
    // 2) Gemini is the next API fallback.
    // 3) Edge/Docker and Local/Docker are reserved for later self-hosted engines.
    // Azure and Google Cloud are intentionally not in Auto until explicitly configured.
    const autoOrder = [
      "elevenlabs",
      "gemini",
      "edge",
      "local"
    ];

    const order =
      engine === "auto"
        ? autoOrder
        : [engine];

    const failures = [];

    for (const name of order) {
      try {
        const result = await providers[name]();

        console.log("VOICE PROVIDER SUCCESS", {
          provider: result.engine,
          characters: text.length
        });

        return res.status(200).json({
          ok: true,
          engine: result.engine,
          voice: result.voice,
          audio: result.audio,
          sampleRate: result.sampleRate,
          channels: result.channels,
          type: "audio",
          fallback: engine === "auto",
          attempted: name
        });
      } catch (error) {
        const message = error?.message || String(error);
        failures.push(`${name}: ${message}`);
        console.error("VOICE PROVIDER FAILED", {
          provider: name,
          message
        });
      }
    }

    return res.status(502).json({
      ok: false,
      error: "No configured voice engine could generate the narration.",
      details: failures.join("\n")
    });

  } catch (error) {
    console.error("VOICE ROUTER FAILURE:", error);

    return res.status(502).json({
      ok: false,
      error: "Voice generation failed.",
      details: error?.message || String(error)
    });
  }
}
