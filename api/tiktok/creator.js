// api/tiktok/creator.js
// The Inner Edge — Fetch TikTok Creator Posting Settings

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

    // Handle preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only GET allowed
    if (req.method !== "GET") {
        return res.status(405).json({
            ok: false,
            error: "Method not allowed"
        });
    }

    try {

        // =========================
        // 1. Read auth cookies
        // =========================

        const cookies = parseCookies(req.headers.cookie || "");

        let accessToken = cookies["tiktok_access_token"];
        const refreshToken = cookies["tiktok_refresh_token"];
        const openId = cookies["tiktok_open_id"];
        const tokenExpires = Number(cookies["tiktok_token_expires"] || 0);
        const cachedCreatorInfo = cookies["tiktok_creator_info"];

        if (!openId) {
            return res.status(401).json({
                ok: false,
                error: "TikTok is not connected. Please connect your account."
            });
        }

        // =========================
        // 2. Auto-refresh if access token expired
        // =========================

        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        // If the token is expired OR about to expire within 5 minutes, refresh it
        if ((!accessToken || (tokenExpires && now > (tokenExpires - fiveMinutes))) && refreshToken) {

            const refreshResult = await refreshAccessToken(refreshToken);

            if (refreshResult.success) {

                accessToken = refreshResult.access_token;

                // Update access token cookie
                const newExpires = Date.now() + refreshResult.expires_in * 1000;
                const secureFlag = isProduction() ? "Secure; " : "";

                res.setHeader("Set-Cookie", [
                    buildCookie(
                        "tiktok_access_token",
                        refreshResult.access_token,
                        Math.max(60, refreshResult.expires_in - 60),
                        secureFlag
                    ),
                    buildCookie(
                        "tiktok_token_expires",
                        String(newExpires),
                        Math.max(60, refreshResult.expires_in - 60),
                        secureFlag
                    ),
                    ...(refreshResult.refresh_token ? [
                        buildCookie(
                            "tiktok_refresh_token",
                            refreshResult.refresh_token,
                            Math.max(60, (refreshResult.refresh_expires_in || 31536000) - 60),
                            secureFlag
                        )
                    ] : [])
                ]);

            } else {
                // Refresh failed — clear cookies and force reconnect
                clearAuthCookies(res);
                return res.status(401).json({
                    ok: false,
                    error: "TikTok session expired. Please reconnect."
                });
            }
        }

        if (!accessToken) {
            return res.status(401).json({
                ok: false,
                error: "TikTok is not connected. Please connect your account."
            });
        }

        // =========================
        // 3. Fetch creator info from TikTok
        // =========================

        const creatorResponse = await fetch(
            "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json; charset=UTF-8"
                }
            }
        );

        const creatorData = await creatorResponse.json();

        // TikTok returns error inside `error` object even on 200
        if (!creatorResponse.ok || (creatorData.error && creatorData.error.code !== "ok")) {
            console.error("TikTok creator info failed:", creatorData);

            // If the token is invalid/expired, clear cookies
            const errorCode = creatorData?.error?.code || "";
            if (
                errorCode === "access_token_invalid" ||
                errorCode === "access_token_expired" ||
                creatorResponse.status === 401
            ) {
                clearAuthCookies(res);
                return res.status(401).json({
                    ok: false,
                    error: "TikTok session expired. Please reconnect."
                });
            }

            return res.status(502).json({
                ok: false,
                error: creatorData?.error?.message || "Could not load TikTok creator settings."
            });
        }

        const creator = creatorData.data || {};

        // =========================
        // 4. Normalize the response for the frontend
        // =========================

        const normalized = {
            creator_avatar_url: creator.creator_avatar_url || "",
            creator_username: creator.creator_username || "",
            creator_nickname: creator.creator_nickname || "",

            // Privacy options the creator can choose from
            privacy_level_options: Array.isArray(creator.privacy_level_options)
                ? creator.privacy_level_options
                : ["SELF_ONLY"],

            // Interaction toggles (TikTok returns true if DISABLED)
            comment_disabled: Boolean(creator.comment_disabled),
            duet_disabled: Boolean(creator.duet_disabled),
            stitch_disabled: Boolean(creator.stitch_disabled),

            // Video duration limits
            max_video_post_duration_sec: Number(creator.max_video_post_duration_sec || 0)
        };

        // =========================
        // 5. Update cached creator info cookie
        // =========================

        const secureFlag = isProduction() ? "Secure; " : "";

        res.setHeader(
            "Set-Cookie",
            buildCookie(
                "tiktok_creator_info",
                JSON.stringify({
                    username: normalized.creator_username,
                    display_name: normalized.creator_nickname,
                    avatar_url: normalized.creator_avatar_url
                }),
                31536000,
                secureFlag
            )
        );

        // =========================
        // 6. Return to frontend
        // =========================

        return res.status(200).json({
            ok: true,
            creator: normalized
        });

    } catch (error) {

        console.error("TikTok creator endpoint error:", error);

        return res.status(500).json({
            ok: false,
            error: "Failed to load TikTok creator settings.",
            details: error.message
        });
    }
}


/* =========================================================
   HELPER FUNCTIONS
========================================================= */

/**
 * Exchanges a refresh token for a new access token.
 */
async function refreshAccessToken(refreshToken) {

    try {

        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

        if (!clientKey || !clientSecret) {
            console.error("Missing TikTok client credentials for token refresh.");
            return { success: false };
        }

        const body = new URLSearchParams({
            client_key: clientKey,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken
        });

        const response = await fetch(
            "https://open.tiktokapis.com/v2/oauth/token/",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cache-Control": "no-cache"
                },
                body: body.toString()
            }
        );

        const data = await response.json();

        if (!response.ok || !data.access_token) {
            console.error("TikTok token refresh failed:", data);
            return { success: false };
        }

        return {
            success: true,
            access_token: data.access_token,
            refresh_token: data.refresh_token || refreshToken,
            expires_in: Number(data.expires_in || 86400),
            refresh_expires_in: Number(data.refresh_expires_in || 31536000)
        };

    } catch (error) {
        console.error("Refresh token exception:", error);
        return { success: false };
    }
}

/**
 * Clears all TikTok auth cookies.
 */
function clearAuthCookies(res) {

    const secureFlag = isProduction() ? "Secure; " : "";

    const cookieNames = [
        "tiktok_access_token",
        "tiktok_refresh_token",
        "tiktok_open_id",
        "tiktok_scope",
        "tiktok_token_expires",
        "tiktok_creator_info"
    ];

    res.setHeader(
        "Set-Cookie",
        cookieNames.map(name => buildCookie(name, "", 0, secureFlag))
    );
}

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

/**
 * Returns true if running in a production environment (HTTPS required).
 */
function isProduction() {
    return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}
