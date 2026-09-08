import { put, list } from '@vercel/blob';

// ========================================================
// 🔐 CHANGE PASSWORDS HERE (must match public/index.html)
// ========================================================
const TEAM_CODE = "8800";
const ADMIN_CODE = "9890";
// ========================================================

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
            "X-App-Code": "8700"
          },
          body: JSON.stringify({ image, prompt, lora })
        });

        const data = await response.json();

        if (data.error) {
          const msg = (data.message || data.error).toLowerCase();
          const isRateLimit = msg.includes("limit") || msg.includes("quota") || msg.includes("zerogpu");
          if (isRateLimit) {
            lastError = data.message || data.error;
            continue;
          } else {
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

    try {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      console.log(`[Team] Blob token present: ${blobToken ? 'YES' : 'NO'}`);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sessionKey = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const inputBuffer = dataUrlToBuffer(image);
      const outputBuffer = dataUrlToBuffer(successResult.image);
      console.log(`[Team] Uploading input (${inputBuffer.length} bytes) and output (${outputBuffer.length} bytes)`);

      const inputBlob = await put(
        `logs/${timestamp}_${sessionKey}_input.jpg`,
        inputBuffer,
        { access: 'public', contentType: 'image/jpeg', token: blobToken }
      );
      console.log(`[Team] Input uploaded: ${inputBlob.url}`);

      const outputBlob = await put(
        `logs/${timestamp}_${sessionKey}_output.png`,
        outputBuffer,
        { access: 'public', contentType: 'image/png', token: blobToken }
      );
      console.log(`[Team] Output uploaded: ${outputBlob.url}`);

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
        { access: 'public', contentType: 'application/json', token: blobToken }
      );

      console.log(`[Team] ✅ Logged to blob: ${sessionKey}`);
    } catch (logErr) {
      console.error(`[Team] ❌ Log error (non-fatal): ${logErr.message}`);
      console.error(`[Team] Stack: ${logErr.stack}`);
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
