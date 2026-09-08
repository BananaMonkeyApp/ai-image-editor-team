import { list } from '@vercel/blob';

// ========================================================
// 🔐 CHANGE ADMIN CODE HERE (must match public/index.html)
// ========================================================
const ADMIN_CODE = "9890";
// ========================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Code");

  if (req.method === "OPTIONS") return res.status(200).end();

  const providedCode = req.headers["x-app-code"];
  if (providedCode !== ADMIN_CODE) {
    return res.status(401).json({ error: "Admin only" });
  }

  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    console.log(`[Admin] Blob token present: ${blobToken ? 'YES' : 'NO'}`);
    const { blobs } = await list({ prefix: 'logs/', token: blobToken });
    console.log(`[Admin] Found ${blobs.length} blobs`);

    const sessions = {};
    for (const blob of blobs) {
      const filename = blob.pathname.split('/').pop();
      const match = filename.match(/^(.+?)_(session_\d+_\w+)_(input|output|meta)\.(jpg|png|json)$/);
      if (!match) continue;

      const [, timestamp, sessionKey, type] = match;
      if (!sessions[sessionKey]) {
        sessions[sessionKey] = { timestamp, sessionKey };
      }

      if (type === 'input') sessions[sessionKey].inputUrl = blob.url;
      else if (type === 'output') sessions[sessionKey].outputUrl = blob.url;
      else if (type === 'meta') sessions[sessionKey].metaUrl = blob.url;
    }

    const sessionList = Object.values(sessions);
    for (const s of sessionList) {
      if (s.metaUrl) {
        try {
          const metaRes = await fetch(s.metaUrl);
          const meta = await metaRes.json();
          s.prompt = meta.prompt;
          s.lora = meta.lora;
          s.server = meta.server;
        } catch {}
      }
    }

    sessionList.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return res.status(200).json({ sessions: sessionList });
  } catch (error) {
    console.error("[Admin] Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
