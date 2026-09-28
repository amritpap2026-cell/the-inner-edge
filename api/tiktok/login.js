// api/tiktok/login.js
// The Inner Edge — TikTok OAuth Login Redirect

export default function handler(req, res) {

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

    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");

    // Handle preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only GET allowed
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {

        // =========================
        // Environment Variables
        // =========================

        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        const redirectUri = process.env.TIKTOK_REDIRECT_URI;

        // Validate required environment variables
        if (!clientKey) {
            console.error("TIKTOK_CLIENT_KEY is not set in Vercel environment variables.");
            return res.status(500).json({
                error: "TikTok client key is not configured on the server."
            });
        }

        if (!redirectUri) {
            console.error("TIKTOK_REDIRECT_URI is not set in Vercel environment variables.");
            return res.status(500).json({
                error: "TikTok redirect URI is not configured on the server."
            });
        }

        // =========================
        // Sanitize inputs
        // =========================

        // Trim whitespace/newlines that may have crept in from copy-paste
        const cleanClientKey = String(clientKey).trim();
        const cleanRedirectUri = String(redirectUri).trim();

        // =========================
        // Generate State Token (CSRF Protection)
        // =========================

        const state = generateRandomState();

        // Store state in an HttpOnly cookie for later verification
        res.setHeader(
            "Set-Cookie",
            `tiktok_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        );

        // =========================
        // Build TikTok Authorization URL
        // =========================

        // Minimal scope — only request what your app is approved for.
        // Add video.publish / video.upload here ONLY after TikTok approves them.
        const scope = "user.info.basic";

        const authParams = new URLSearchParams({
            client_key: cleanClientKey,
            scope: scope,
            redirect_uri: cleanRedirectUri,
            state: state,
            response_type: "code"
        });

        const authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?${authParams.toString()}`;

        // =========================
        // DEBUG — Log the exact URL being sent
        // =========================

        console.log("===== TIKTOK LOGIN DEBUG =====");
        console.log("Client Key (raw length):", clientKey ? clientKey.length : 0);
        console.log("Client Key (clean length):", cleanClientKey.length);
        console.log("Client Key (first 6 chars):", cleanClientKey.substring(0, 6));
        console.log("Redirect URI (raw):", JSON.stringify(redirectUri));
        console.log("Redirect URI (clean):", JSON.stringify(cleanRedirectUri));
        console.log("Scope:", scope);
        console.log("State:", state);
        console.log("Full Authorization URL:", authorizationUrl);
        console.log("==============================");

        // =========================
        // Redirect User to TikTok
        // =========================

        return res.redirect(302, authorizationUrl);

    } catch (error) {

        console.error("TikTok login error:", error);

        return res.status(500).json({
            error: "Failed to initiate TikTok login.",
            details: error.message
        });
    }
}


/* =========================================================
   HELPER FUNCTIONS
========================================================= */

/**
 * Generates a cryptographically secure random state string
 * for CSRF protection during the OAuth flow.
 */
function generateRandomState() {

    const array = new Uint8Array(32);

    // Use crypto if available (Node.js 18+ / modern runtimes)
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(array);
    } else {
        // Fallback for older runtimes
        for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
}
