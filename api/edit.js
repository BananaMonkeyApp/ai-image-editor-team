import { put, list } from '@vercel/blob';

const TEAM_CODE = "8800";
const ADMIN_CODE = "8700";

// Your 20 backend servers (uses your existing infrastructure)
const BACKEND_SERVERS = [
  "https://ai-image-editor-iota-beige.vercel.app/api/edit",
  "https://ai-image-editor-2.vercel.app/api/edit",
  "https://ai-image-editor-3.vercel.app/api/edit",
  "https://ai-image-editor-4.vercel.app/api/edit",
  "https://ai-image-editor-5.vercel.app/api/edit",
  "https://ai-image-editor-6.vercel.app/api/edit",
  "https://ai-image-editor-7.vercel.app/api/edit",
  "https://ai-image-editor-8.vercel.app/api/edit",
  "https://ai-image-editor-9.vercel.app/api/edit",
  "https://ai-image-editor-10.vercel.app/api/edit",
  "https://ai-image-editor-11.vercel.app/api/edit",
  "https://ai-image-editor-12.vercel.app/api/edit",
  "https://ai-image-editor-13.vercel.app/api/edit",
  "https://ai-image-editor-14.vercel.app/api/edit",
  "https://ai-image-editor-15.vercel.app/api/edit",
  "https://ai-image-editor-16.vercel.app/api/edit",
  "https://ai-image-editor-17.vercel.app/api/edit",
  "https://ai-image-editor-18.vercel.app/api/edit",
  "https://ai-image-editor-19.vercel.app/api/edit",
  "https://ai-image-editor-20.vercel.app/api/edit"
];

// Extract base64 image bytes from data URL
function dataUrlToBuffer(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  const base64Part = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Buffer.from(base64Part, 'base64');
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const providedCode = req.headers["x-app-code"] || req.body?.code;
  if (providedCode !== TEAM_CODE && providedCode !== ADMIN_CODE) {
    return res.status(401).json({ error: "Invalid access code" });
  }

  try {
    const { image, prompt, lora } = req.body;
    if (!image) return res.status(400).json({ error: "Missing image" });
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    // Shuffle servers, try one after another
    const shuffled = [...BACKEND_SERVERS].sort(() => Math.random() - 0.5);
    let lastError = null;
    let successResult = null;
    let usedServer = null;

    for (const serverUrl of shuffled) {
      try {
        console.log(`[Team] Trying ${serverUrl}`);
        const response = await fetch(serverUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-App-Code": "8700"  // backend's own code
          },
          body: JSON.stringify({ image, prompt, lora })
        });

        const data = await response.json();

        if (data.error) {
          const msg = (data.message || data.error).toLowerCase();
          const isRateLimit = msg.includes("limit") || msg.includes("quota") || msg.includes("zerogpu");
          if (isRateLimit) {
            lastError = data.message || data.error;
            continue;  // try next server
          } else {
            // Non-rate-limit error (e.g., NCII block) — return immediately
            return res.status(200).json(data);
          }
        }

        if (data.image) {
          successResult = data;
          usedServer = serverUrl;
          break;
        }
      } catch (err) {
        console.error(`[Team] Server error: ${err.message}`);
        lastError = err.message;
        continue;
      }
    }

    if (!successResult) {
      return res.status(500).json({
        error: "All servers failed",
        message: lastError || "Unknown"
      });
    }

    // Log to Vercel Blob
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sessionKey = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const inputBuffer = dataUrlToBuffer(image);
      const outputBuffer = dataUrlToBuffer(successResult.image);

      // Store input image
      const inputBlob = await put(
        `logs/${timestamp}_${sessionKey}_input.jpg`,
        inputBuffer,
        { access: 'public', contentType: 'image/jpeg' }
      );

      // Store output image
      const outputBlob = await put(
        `logs/${timestamp}_${sessionKey}_output.png`,
        outputBuffer,
        { access: 'public', contentType: 'image/png' }
      );

      // Store metadata
      const metadata = {
        timestamp: new Date().toISOString(),
        prompt: prompt,
        lora: lora || "Photo-to-Anime",
        inputUrl: inputBlob.url,
        outputUrl: outputBlob.url,
        server: usedServer,
        sessionKey
      };
      await put(
        `logs/${timestamp}_${sessionKey}_meta.json`,
        JSON.stringify(metadata),
        { access: 'public', contentType: 'application/json' }
      );

      console.log(`[Team] Logged to blob: ${sessionKey}`);
    } catch (logErr) {
      console.error(`[Team] Log error (non-fatal): ${logErr.message}`);
      // Don't fail the request just because logging failed
    }

    return res.status(200).json(successResult);
  } catch (error) {
    console.error("[Team] Error:", error);
    return res.status(500).json({ error: "Server error", message: error.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } }
};
