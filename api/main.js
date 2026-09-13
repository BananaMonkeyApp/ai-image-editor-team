import { put, list, del } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '8800';

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

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

async function requireUser(req) {
  const decoded = verifyToken(req);
  if (!decoded) return null;
  const { rows } = await sql`SELECT * FROM users WHERE id = ${decoded.id} LIMIT 1`;
  return rows[0] || null;
}

function dataUrlToBuffer(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  const base64Part = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Buffer.from(base64Part, 'base64');
}

async function logCoinChange(userId, change, reason, reference, balanceAfter) {
  await sql`INSERT INTO coin_logs (user_id, change, reason, reference, balance_after) VALUES (${userId}, ${change}, ${reason}, ${reference}, ${balanceAfter})`;
}

function sanitizeUser(u) {
  return { id: u.id, email: u.email, balance: u.balance, total_spent: u.total_spent, is_admin: u.is_admin, created_at: u.created_at };
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = (req.query.action || req.body?.action || '').toLowerCase();

  try {
    switch (action) {
      case 'signup':      return await handleSignup(req, res);
      case 'login':       return await handleLogin(req, res);
      case 'me':          return await handleMe(req, res);
      case 'config':      return await handleConfig(req, res);
      case 'create_order': return await handleCreateOrder(req, res);
      case 'verify_payment': return await handleVerifyPayment(req, res);
      case 'my_transactions': return await handleMyTransactions(req, res);
      case 'edit':        return await handleEdit(req, res);
      case 'admin_users': return await handleAdminUsers(req, res);
      case 'admin_add_coins': return await handleAdminAddCoins(req, res);
      case 'admin_edits': return await handleAdminEdits(req, res);
      case 'admin_transactions': return await handleAdminTransactions(req, res);
      case 'admin_save_preset': return await handleAdminSavePreset(req, res);
      case 'admin_delete_preset': return await handleAdminDeletePreset(req, res);
      case 'admin_save_pack': return await handleAdminSavePack(req, res);
      case 'admin_delete_pack': return await handleAdminDeletePack(req, res);
      case 'admin_save_settings': return await handleAdminSaveSettings(req, res);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error("[Main] Error:", error);
    return res.status(500).json({ error: "Server error", message: error.message });
  }
}

async function handleSignup(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 4) return res.status(400).json({ error: "Password too short" });
  const emailLower = email.toLowerCase().trim();
  const existing = await sql`SELECT id FROM users WHERE email = ${emailLower} LIMIT 1`;
  if (existing.rows.length > 0) return res.status(400).json({ error: "Email already registered" });
  const passwordHash = await bcrypt.hash(password, 10);
  const isAdmin = emailLower === ADMIN_EMAIL;
  const { rows } = await sql`
    INSERT INTO users (email, password_hash, is_admin, balance)
    VALUES (${emailLower}, ${passwordHash}, ${isAdmin}, 0)
    RETURNING id, email, balance, is_admin, total_spent, created_at
  `;
  const user = rows[0];
  const token = issueToken(user);
  return res.status(200).json({ token, user });
}

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const emailLower = email.toLowerCase().trim();

  if (emailLower === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const existing = await sql`SELECT * FROM users WHERE email = ${emailLower} LIMIT 1`;
    let user;
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      const created = await sql`INSERT INTO users (email, password_hash, is_admin, balance) VALUES (${emailLower}, ${passwordHash}, TRUE, 0) RETURNING *`;
      user = created.rows[0];
    } else {
      user = existing.rows[0];
      if (!user.is_admin) {
        await sql`UPDATE users SET is_admin = TRUE WHERE id = ${user.id}`;
        user.is_admin = true;
      }
    }
    return res.status(200).json({ token: issueToken(user), user: sanitizeUser(user) });
  }

  const { rows } = await sql`SELECT * FROM users WHERE email = ${emailLower} LIMIT 1`;
  if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
  const user = rows[0];
  if (user.is_disabled) return res.status(403).json({ error: "Account disabled" });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });
  return res.status(200).json({ token: issueToken(user), user: sanitizeUser(user) });
}

async function handleMe(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  return res.status(200).json({ user: sanitizeUser(user) });
}

async function handleConfig(req, res) {
  const presets = await sql`SELECT * FROM presets WHERE is_active = TRUE ORDER BY sort_order, id`;
  const packs = await sql`SELECT * FROM coin_packs WHERE is_active = TRUE ORDER BY sort_order, id`;
  const settingsRows = await sql`SELECT key, value FROM settings`;
  const settings = {};
  for (const row of settingsRows.rows) settings[row.key] = row.value;

  return res.status(200).json({
    presets: presets.rows,
    coin_packs: packs.rows,
    custom_prompt_cost: parseInt(settings.custom_prompt_cost || '120'),
    custom_prompt_enabled: (settings.custom_prompt_enabled || 'true') === 'true',
    default_lora: settings.default_lora || 'Photo-to-Anime',
    user_notes: settings.user_notes || '',
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || ''
  });
}

async function handleCreateOrder(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { pack_id } = req.body || {};
  if (!pack_id) return res.status(400).json({ error: "pack_id required" });
  const { rows } = await sql`SELECT * FROM coin_packs WHERE id = ${pack_id} AND is_active = TRUE LIMIT 1`;
  if (rows.length === 0) return res.status(400).json({ error: "Pack not found" });
  const pack = rows[0];
  const razorpay = getRazorpay();
  const order = await razorpay.orders.create({
    amount: pack.price_paise,
    currency: 'INR',
    receipt: `pack_${pack.id}_u${user.id}_${Date.now()}`,
    notes: { user_id: String(user.id), pack_id: String(pack.id), coins: String(pack.coins) }
  });
  await sql`INSERT INTO transactions (user_id, razorpay_order_id, amount_paise, coins_added, status) VALUES (${user.id}, ${order.id}, ${pack.price_paise}, ${pack.coins}, 'pending')`;
  return res.status(200).json({ order_id: order.id, amount: order.amount, currency: order.currency, coins: pack.coins, razorpay_key_id: process.env.RAZORPAY_KEY_ID });
}

async function handleVerifyPayment(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: "Missing payment details" });
  const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  if (expectedSignature !== razorpay_signature) return res.status(400).json({ error: "Invalid signature" });
  const { rows } = await sql`SELECT * FROM transactions WHERE razorpay_order_id = ${razorpay_order_id} LIMIT 1`;
  if (rows.length === 0) return res.status(400).json({ error: "Transaction not found" });
  const txn = rows[0];
  if (txn.user_id !== user.id) return res.status(403).json({ error: "Wrong user" });
  if (txn.status === 'completed') return res.status(200).json({ success: true, message: "Already processed", new_balance: user.balance, coins_added: 0 });
  await sql`UPDATE transactions SET status = 'completed', razorpay_payment_id = ${razorpay_payment_id} WHERE id = ${txn.id}`;
  const updated = await sql`UPDATE users SET balance = balance + ${txn.coins_added}, total_spent = total_spent + ${Math.round(txn.amount_paise / 100)} WHERE id = ${user.id} RETURNING balance`;
  await logCoinChange(user.id, txn.coins_added, 'purchase', razorpay_payment_id, updated.rows[0].balance);
  return res.status(200).json({ success: true, coins_added: txn.coins_added, new_balance: updated.rows[0].balance });
}

async function handleMyTransactions(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { rows } = await sql`SELECT id, amount_paise, coins_added, status, created_at FROM transactions WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 50`;
  return res.status(200).json({ transactions: rows });
}

async function handleEdit(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (user.is_disabled) return res.status(403).json({ error: "Account disabled" });
  const { image, prompt, lora, preset_id, is_custom } = req.body || {};
  if (!image) return res.status(400).json({ error: "Missing image" });
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  let cost;
  if (preset_id) {
    const { rows } = await sql`SELECT cost FROM presets WHERE id = ${preset_id} AND is_active = TRUE LIMIT 1`;
    if (rows.length === 0) return res.status(400).json({ error: "Preset not found" });
    cost = rows[0].cost;
  } else if (is_custom) {
    const setting = await sql`SELECT value FROM settings WHERE key = 'custom_prompt_cost'`;
    const enabled = await sql`SELECT value FROM settings WHERE key = 'custom_prompt_enabled'`;
    if (enabled.rows[0]?.value !== 'true') return res.status(400).json({ error: "Custom prompts disabled" });
    cost = parseInt(setting.rows[0]?.value || '120');
  } else {
    return res.status(400).json({ error: "Must specify preset_id or is_custom" });
  }

  if (user.balance < cost) return res.status(400).json({ error: "Insufficient coins", need: cost, have: user.balance });

  const afterDeduct = await sql`UPDATE users SET balance = balance - ${cost} WHERE id = ${user.id} AND balance >= ${cost} RETURNING balance`;
  if (afterDeduct.rows.length === 0) return res.status(400).json({ error: "Insufficient coins" });
  const balanceAfterDeduct = afterDeduct.rows[0].balance;

  const { rows: editRows } = await sql`INSERT INTO edits (user_id, prompt, lora, coins_spent, status) VALUES (${user.id}, ${prompt}, ${lora || 'Photo-to-Anime'}, ${cost}, 'processing') RETURNING id`;
  const editId = editRows[0].id;
  await logCoinChange(user.id, -cost, 'edit', `edit_${editId}`, balanceAfterDeduct);

  const shuffled = [...BACKEND_SERVERS].sort(() => Math.random() - 0.5);
  let successResult = null;
  let usedServer = null;
  let lastError = null;

  for (const serverUrl of shuffled) {
    try {
      const response = await fetch(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Code": "8700" },
        body: JSON.stringify({ image, prompt, lora })
      });
      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); } catch {
        lastError = `Server ${serverUrl.slice(-30)} returned non-JSON`;
        continue;
      }
      if (data.error) {
        const msg = (data.message || data.error).toLowerCase();
        const isContentBlock = msg.includes('ncii') || msg.includes('safety') || msg.includes('content filter') || msg.includes('blocked') || msg.includes('nsfw');
        if (isContentBlock) {
          const refunded = await sql`UPDATE users SET balance = balance + ${cost} WHERE id = ${user.id} RETURNING balance`;
          await logCoinChange(user.id, cost, 'refund', `edit_${editId}`, refunded.rows[0].balance);
          await sql`UPDATE edits SET status = 'refunded', error_message = ${data.message || data.error} WHERE id = ${editId}`;
          return res.status(400).json({ error: "Content blocked", message: data.message || data.error, refunded: cost, new_balance: refunded.rows[0].balance });
        }
        lastError = data.message || data.error;
        continue;
      }
      if (data.image) {
        successResult = data;
        usedServer = serverUrl;
        break;
      }
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  if (!successResult) {
    const refunded = await sql`UPDATE users SET balance = balance + ${cost} WHERE id = ${user.id} RETURNING balance`;
    await logCoinChange(user.id, cost, 'refund', `edit_${editId}`, refunded.rows[0].balance);
    await sql`UPDATE edits SET status = 'refunded', error_message = ${lastError || 'All servers failed'} WHERE id = ${editId}`;
    return res.status(500).json({ error: "All servers failed", message: lastError || "Please try again later", refunded: cost, new_balance: refunded.rows[0].balance });
  }

  let inputUrl = null, outputUrl = null;
  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionKey = `edit_${editId}_${Date.now()}`;
    const inputBuffer = dataUrlToBuffer(image);
    const outputBuffer = dataUrlToBuffer(successResult.image);
    const inputBlob = await put(`logs/${timestamp}_${sessionKey}_input.jpg`, inputBuffer, { access: 'public', contentType: 'image/jpeg', token: blobToken });
    const outputBlob = await put(`logs/${timestamp}_${sessionKey}_output.png`, outputBuffer, { access: 'public', contentType: 'image/png', token: blobToken });
    inputUrl = inputBlob.url;
    outputUrl = outputBlob.url;
  } catch (blobErr) {
    console.error(`[Edit] Blob upload failed: ${blobErr.message}`);
  }

  await sql`UPDATE edits SET status = 'success', input_url = ${inputUrl}, output_url = ${outputUrl}, server_used = ${usedServer} WHERE id = ${editId}`;

  return res.status(200).json({ success: true, image: successResult.image, coins_spent: cost, new_balance: balanceAfterDeduct });
}

async function requireAdmin(req, res) {
  const user = await requireUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  if (!user.is_admin) { res.status(403).json({ error: "Admin only" }); return null; }
  return user;
}

async function handleAdminUsers(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { rows } = await sql`SELECT id, email, balance, total_spent, is_admin, is_disabled, created_at FROM users ORDER BY created_at DESC`;
  return res.status(200).json({ users: rows });
}

async function handleAdminAddCoins(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { user_id, coins } = req.body || {};
  const c = parseInt(coins);
  if (!user_id || isNaN(c)) return res.status(400).json({ error: "Invalid params" });
  const { rows } = await sql`UPDATE users SET balance = GREATEST(0, balance + ${c}) WHERE id = ${user_id} RETURNING balance`;
  if (rows.length === 0) return res.status(400).json({ error: "User not found" });
  await logCoinChange(user_id, c, 'admin_bonus', `admin_${admin.id}`, rows[0].balance);
  return res.status(200).json({ success: true, new_balance: rows[0].balance });
}

async function handleAdminEdits(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { rows } = await sql`SELECT e.*, u.email FROM edits e LEFT JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC LIMIT 200`;
  return res.status(200).json({ edits: rows });
}

async function handleAdminTransactions(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { rows } = await sql`SELECT t.*, u.email FROM transactions t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 200`;
  return res.status(200).json({ transactions: rows });
}

async function handleAdminSavePreset(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id, name, prompt, cost, sort_order, is_active } = req.body || {};
  if (!name || !prompt || cost == null) return res.status(400).json({ error: "Missing fields" });
  if (id) {
    await sql`UPDATE presets SET name = ${name}, prompt = ${prompt}, cost = ${cost}, sort_order = ${sort_order || 0}, is_active = ${is_active !== false} WHERE id = ${id}`;
    return res.status(200).json({ success: true, id });
  } else {
    const { rows } = await sql`INSERT INTO presets (name, prompt, cost, sort_order, is_active) VALUES (${name}, ${prompt}, ${cost}, ${sort_order || 0}, ${is_active !== false}) RETURNING id`;
    return res.status(200).json({ success: true, id: rows[0].id });
  }
}

async function handleAdminDeletePreset(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  await sql`DELETE FROM presets WHERE id = ${id}`;
  return res.status(200).json({ success: true });
}

async function handleAdminSavePack(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id, price_paise, coins, sort_order, is_active } = req.body || {};
  if (price_paise == null || coins == null) return res.status(400).json({ error: "Missing fields" });
  if (id) {
    await sql`UPDATE coin_packs SET price_paise = ${price_paise}, coins = ${coins}, sort_order = ${sort_order || 0}, is_active = ${is_active !== false} WHERE id = ${id}`;
    return res.status(200).json({ success: true, id });
  } else {
    const { rows } = await sql`INSERT INTO coin_packs (price_paise, coins, sort_order, is_active) VALUES (${price_paise}, ${coins}, ${sort_order || 0}, ${is_active !== false}) RETURNING id`;
    return res.status(200).json({ success: true, id: rows[0].id });
  }
}

async function handleAdminDeletePack(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  await sql`DELETE FROM coin_packs WHERE id = ${id}`;
  return res.status(200).json({ success: true });
}

async function handleAdminSaveSettings(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { custom_prompt_cost, custom_prompt_enabled, default_lora, user_notes } = req.body || {};

  if (custom_prompt_cost != null) {
    await sql`INSERT INTO settings (key, value) VALUES ('custom_prompt_cost', ${String(custom_prompt_cost)}) ON CONFLICT (key) DO UPDATE SET value = ${String(custom_prompt_cost)}`;
  }
  if (custom_prompt_enabled != null) {
    const v = custom_prompt_enabled ? 'true' : 'false';
    await sql`INSERT INTO settings (key, value) VALUES ('custom_prompt_enabled', ${v}) ON CONFLICT (key) DO UPDATE SET value = ${v}`;
  }
  if (default_lora != null) {
    await sql`INSERT INTO settings (key, value) VALUES ('default_lora', ${String(default_lora)}) ON CONFLICT (key) DO UPDATE SET value = ${String(default_lora)}`;
  }
  if (user_notes != null) {
    await sql`INSERT INTO settings (key, value) VALUES ('user_notes', ${String(user_notes)}) ON CONFLICT (key) DO UPDATE SET value = ${String(user_notes)}`;
  }

  return res.status(200).json({ success: true });
}

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } }
};
