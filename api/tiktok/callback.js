// api/tiktok/callback.js
// The Inner Edge — TikTok OAuth Callback Handler

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

    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {

        // =========================
        // 1. Extract query parameters
        // =========================

        const { code, state, error, error_description } = req.query;

        // TikTok may return an error directly (user denied access, etc.)
        if (error) {
            console.error("TikTok returned an OAuth error:", error, error_description);
            return res.redirect(
                302,
                "/?tiktok_error=" + encodeURIComponent(error)
            );
        }

        if (!code) {
            console.error("No authorization code received from TikTok.");
            return res.redirect(302, "/?tiktok_error=missing_code");
        }

        if (!state) {
            console.error("No state parameter received from TikTok.");
            return res.redirect(302, "/?tiktok_error=missing_state");
        }

        // =========================
        // 2. Verify state (CSRF protection)
        // =========================

        const cookies = parseCookies(req.headers.cookie || "");
        const savedState = cookies["tiktok_oauth_state"];

        if (!savedState) {
            console.error("No saved state cookie found.");
            return res.redirect(302, "/?tiktok_error=state_cookie_missing");
        }

        if (savedState !== state) {
            console.error("State mismatch. Possible CSRF attack.");
            return res.redirect(302, "/?tiktok_error=state_mismatch");
        }

        // Clear the state cookie immediately after verification
        res.setHeader(
            "Set-Cookie",
            "tiktok_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
        );

        // =========================
        // 3. Validate environment variables
        // =========================

        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
        const redirectUri = process.env.TIKTOK_REDIRECT_URI;

        if (!clientKey || !clientSecret || !redirectUri) {
            console.error("Missing TikTok environment variables.");
            return res.redirect(302, "/?tiktok_error=server_config");
        }

        // =========================
        // 4. Exchange authorization code for access token
        // =========================

        const tokenParams = new URLSearchParams({
            client_key: clientKey,
            client_secret: clientSecret,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
        });

        const tokenResponse = await fetch(
            "https://open.tiktokapis.com/v2/oauth/token/",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cache-Control": "no-cache"
                },
                body: tokenParams.toString()
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || tokenData.error) {
            console.error("TikTok token exchange failed:", tokenData);
            return res.redirect(
                302,
                "/?tiktok_error=" + encodeURIComponent(tokenData.error || "token_exchange_failed")
            );
        }

        if (!tokenData.access_token) {
            console.error("No access token in TikTok response:", tokenData);
            return res.redirect(302, "/?tiktok_error=no_access_token");
        }

        // =========================
        // 5. Fetch creator info (to verify token works)
        // =========================

        let creatorInfo = null;
        try {
            const userResponse = await fetch(
                "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`
                    }
                }
            );

            const userData = await userResponse.json();

            if (userResponse.ok && userData.data?.user) {
                creatorInfo = userData.data.user;
            }
        } catch (userError) {
            console.warn("Could not fetch creator info (non-fatal):", userError);
        }

        // =========================
        // 6. Store tokens in secure HttpOnly cookies
        // =========================

        const accessTokenExpires = Number(tokenData.expires_in || 86400);
        const refreshTokenExpires = Number(tokenData.refresh_expires_in || 31536000);

        // Cookie max-age is in seconds. Use slightly less than the actual expiry
        // so we refresh before the token actually dies.
        const accessCookieMaxAge = Math.max(60, accessTokenExpires - 60);
        const refreshCookieMaxAge = Math.max(60, refreshTokenExpires - 60);

        const isProd = process.env.NODE_ENV === "production" ||
                       process.env.VERCEL === "1";

        // Secure flag must be true on HTTPS, but we support localhost too
        const secureFlag = isProd ? "Secure; " : "";

        const cookiesToSet = [
            // Access token
            buildCookie(
                "tiktok_access_token",
                tokenData.access_token,
                accessCookieMaxAge,
                secureFlag
            ),

            // Refresh token
            buildCookie(
                "tiktok_refresh_token",
                tokenData.refresh_token || "",
                refreshCookieMaxAge,
                secureFlag
            ),

            // Open ID (identifies the TikTok user)
            buildCookie(
                "tiktok_open_id",
                tokenData.open_id || "",
                refreshCookieMaxAge,
                secureFlag
            ),

            // Granted scopes (so we know what the user authorized)
            buildCookie(
                "tiktok_scope",
                tokenData.scope || "",
                refreshCookieMaxAge,
                secureFlag
            ),

            // Expiry timestamp (for client-side awareness)
            buildCookie(
                "tiktok_token_expires",
                String(Date.now() + accessTokenExpires * 1000),
                accessCookieMaxAge,
                secureFlag
            ),

            // Creator display info (non-sensitive, still HttpOnly for consistency)
            buildCookie(
                "tiktok_creator_info",
                JSON.stringify({
                    username: creatorInfo?.username || "",
                    display_name: creatorInfo?.display_name || "",
                    avatar_url: creatorInfo?.avatar_url || ""
                }),
                refreshCookieMaxAge,
                secureFlag
            )
        ];

        res.setHeader("Set-Cookie", cookiesToSet);

        // =========================
        // 7. Redirect back to the app
        // =========================

        return res.redirect(302, "/?tiktok=connected");

    } catch (error) {

        console.error("TikTok callback error:", error);

        return res.redirect(
            302,
            "/?tiktok_error=" + encodeURIComponent("callback_exception")
        );
    }
}


/* =========================================================
   HELPER FUNCTIONS
========================================================= */

/**
 * Parses a raw Cookie header string into a key-value object.
 */
function parseCookies(cookieHeader) {

    const cookies = {};

    if (!cookieHeader) return cookies;

    cookieHeader.split(";").forEach(cookie => {
        const [name, ...valueParts] = cookie.split("=");
        if (!name) return;

        const trimmedName = name.trim();
        const value = valueParts.join("=").trim();

        if (trimmedName) {
            try {
                cookies[trimmedName] = decodeURIComponent(value);
            } catch (error) {
                cookies[trimmedName] = value;
            }
        }
    });

    return cookies;
}

/**
 * Builds a properly formatted Set-Cookie header string.
 */
function buildCookie(name, value, maxAge, secureFlag) {

    const encodedValue = encodeURIComponent(value || "");

    return [
        `${name}=${encodedValue}`,
        "Path=/",
        "HttpOnly",
        secureFlag ? "Secure" : null,
        "SameSite=Lax",
        `Max-Age=${maxAge}`
    ]
        .filter(Boolean)
        .join("; ");
}
