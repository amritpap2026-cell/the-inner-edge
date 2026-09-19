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

    // Browser CORS check
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only POST
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {

        const { prompt } = req.body || {};

        if (!prompt) {
            return res.status(400).json({
                error: "Prompt is required"
            });
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "GEMINI_API_KEY is not configured"
            });
        }

        // Models to try
        const models = [
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite"
        ];

        let lastError = null;

        // Try each model
        for (const model of models) {

            // Retry each model up to 2 times
            for (let attempt = 1; attempt <= 2; attempt++) {

                try {

                    const response = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type": "application/json"
                            },

                            body: JSON.stringify({
                                contents: [
                                    {
                                        parts: [
                                            {
                                                text: prompt
                                            }
                                        ]
                                    }
                                ]
                            })
                        }
                    );

                    const data = await response.json();

                    // Success
                    if (response.ok) {

                        const text =
                            data.candidates?.[0]?.content?.parts?.[0]?.text || "";

                        if (!text) {
                            throw new Error(
                                "Gemini returned an empty response"
                            );
                        }

                        return res.status(200).json({
                            ok: true,
                            model: model,
                            text: text
                        });
                    }

                    // Save error
                    lastError = data;

                    console.error(
                        `Gemini ${model} attempt ${attempt} failed:`,
                        data
                    );

                    // Retry temporary server/rate-limit errors
                    if (
                        response.status === 429 ||
                        response.status === 500 ||
                        response.status === 502 ||
                        response.status === 503 ||
                        response.status === 504
                    ) {

                        if (attempt < 2) {

                            // Wait 2 seconds before retry
                            await new Promise(resolve =>
                                setTimeout(resolve, 2000)
                            );

                            continue;
                        }

                    } else {

                        // Don't retry permanent errors
                        break;
                    }

                } catch (error) {

                    lastError = {
                        message: error.message
                    };

                    console.error(
                        `Gemini ${model} attempt ${attempt} error:`,
                        error
                    );

                    if (attempt < 2) {

                        await new Promise(resolve =>
                            setTimeout(resolve, 2000)
                        );

                        continue;
                    }
                }
            }
        }

        // All models failed
        console.error(
            "All Gemini models failed:",
            lastError
        );

        return res.status(503).json({
            ok: false,
            error: "Gemini is temporarily unavailable",
            details: lastError
        });

    } catch (error) {

        console.error(
            "Server error:",
            error
        );

        return res.status(500).json({
            ok: false,
            error: "AI generation failed"
        });
    }
}
