// api/tiktok/publish.js
// The Inner Edge — TikTok Video Publish Initialization

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
        // 1. Read auth cookies
        // =========================

        const cookies = parseCookies(req.headers.cookie || "");

        let accessToken = cookies["tiktok_access_token"];
        const refreshToken = cookies["tiktok_refresh_token"];
        const openId = cookies["tiktok_open_id"];
        const tokenExpires = Number(cookies["tiktok_token_expires"] || 0);

        if (!openId) {
            return res.status(401).json({
                ok: false,
                error: "TikTok is not connected. Please connect your account."
            });
        }

        // =========================
        // 2. Auto-refresh if token expired
        // =========================

        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        if ((!accessToken || (tokenExpires && now > (tokenExpires - fiveMinutes))) && refreshToken) {

            const refreshResult = await refreshAccessToken(refreshToken);

            if (refreshResult.success) {

                accessToken = refreshResult.access_token;

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
        // 3. Read request body
        // =========================

        const body = typeof req.body === "string"
            ? JSON.parse(req.body)
            : (req.body || {});

        const title = String(body.title || "").slice(0, 2200);
        const privacyLevel = String(body.privacy_level || "");
        const disableComment = Boolean(body.disable_comment);
        const disableDuet = Boolean(body.disable_duet);
        const disableStitch = Boolean(body.disable_stitch);
        const videoSize = Number(body.video_size || 0);

        // Validate
        if (!privacyLevel) {
            return res.status(400).json({
                ok: false,
                error: "privacy_level is required."
            });
        }

        const validPrivacyLevels = [
            "PUBLIC_TO_EVERYONE",
            "MUTUAL_FOLLOW_FRIENDS",
            "FOLLOWER_OF_CREATOR",
            "SELF_ONLY"
        ];

        if (!validPrivacyLevels.includes(privacyLevel)) {
            return res.status(400).json({
                ok: false,
                error: "Invalid privacy_level. Must be one of: " + validPrivacyLevels.join(", ")
            });
        }

        if (!Number.isFinite(videoSize) || videoSize <= 0) {
            return res.status(400).json({
                ok: false,
                error: "video_size must be a positive integer."
            });
        }

        // =========================
        // 4. Calculate chunking parameters
        // =========================

        // TikTok requires chunks to be at least 5 MB and at most 64 MB,
        // except the final chunk which can be larger (up to 128 MB).
        const FIVE_MB = 5 * 1024 * 1024;
        const SIXTY_FOUR_MB = 64 * 1024 * 1024;

        let chunkSize;
        let totalChunkCount;

        if (videoSize < FIVE_MB) {
            // Videos under 5 MB must be uploaded as a single whole chunk
            chunkSize = videoSize;
            totalChunkCount = 1;
        } else if (videoSize <= SIXTY_FOUR_MB) {
            // Videos between 5 MB and 64 MB can be uploaded as a single chunk
            chunkSize = videoSize;
            totalChunkCount = 1;
        } else {
            // Videos over 64 MB must be split into multiple chunks
            chunkSize = SIXTY_FOUR_MB;
            totalChunkCount = Math.floor(videoSize / chunkSize);

            // Ensure the remaining bytes go into a final chunk
            if (videoSize % chunkSize !== 0) {
                totalChunkCount += 1;
            }
        }

        // =========================
        // 5. Initialize the post with TikTok
        // =========================

        const initPayload = {
            post_info: {
                title: title,
                privacy_level: privacyLevel,
                disable_duet: disableDuet,
                disable_stitch: disableStitch,
                disable_comment: disableComment
            },
            source_info: {
                source: "FILE_UPLOAD",
                video_size: videoSize,
                chunk_size: chunkSize,
                total_chunk_count: totalChunkCount
            }
        };

        const initResponse = await fetch(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json; charset=UTF-8"
                },
                body: JSON.stringify(initPayload)
            }
        );

        const initData = await initResponse.json();

        // TikTok returns errors inside an `error` object
        if (!initResponse.ok || (initData.error && initData.error.code !== "ok")) {

            console.error("TikTok publish init failed:", initData);

            // If the token is invalid, clear cookies and prompt reconnect
            const errorCode = initData?.error?.code || "";
            if (
                errorCode === "access_token_invalid" ||
                errorCode === "access_token_expired" ||
                initResponse.status === 401
            ) {
                clearAuthCookies(res);
                return res.status(401).json({
                    ok: false,
                    error: "TikTok session expired. Please reconnect."
                });
            }

            return res.status(502).json({
                ok: false,
                error: initData?.error?.message || "TikTok could not initialize the post.",
                details: initData?.error?.log_id || ""
            });
        }

        // =========================
        // 6. Return upload URL and publish_id to frontend
        // =========================

        const publishId = initData?.data?.publish_id || "";
        const uploadUrl = initData?.data?.upload_url || "";

        if (!publishId || !uploadUrl) {
            console.error("TikTok init response missing publish_id or upload_url:", initData);
            return res.status(502).json({
                ok: false,
                error: "TikTok did not return an upload URL. Please try again."
            });
        }

        return res.status(200).json({
            ok: true,
            publish_id: publishId,
            upload_url: uploadUrl,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount
        });

    } catch (error) {

        console.error("TikTok publish endpoint error:", error);

        return res.status(500).json({
            ok: false,
            error: "Failed to initialize TikTok publish.",
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
