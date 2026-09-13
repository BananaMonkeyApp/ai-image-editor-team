import { sql } from '@vercel/postgres';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return res.status(400).json({ error: "Missing signature or secret" });
  }

  // Get raw body for signature verification
  let rawBody = '';
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks).toString('utf8');
  } catch {
    return res.status(400).json({ error: "Cannot read body" });
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected !== signature) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const body = JSON.parse(rawBody);
  const event = body.event;

  try {
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = body.payload.payment?.entity;
      if (!payment) return res.status(200).json({ ok: true });

      const orderId = payment.order_id;
      const paymentId = payment.id;

      const { rows } = await sql`
        SELECT * FROM transactions WHERE razorpay_order_id = ${orderId} LIMIT 1
      `;
      if (rows.length === 0) return res.status(200).json({ ok: true });

      const txn = rows[0];
      if (txn.status === 'completed') return res.status(200).json({ ok: true, already: true });

      await sql`
        UPDATE transactions
        SET status = 'completed', razorpay_payment_id = ${paymentId}
        WHERE id = ${txn.id}
      `;

      const updated = await sql`
        UPDATE users
        SET balance = balance + ${txn.coins_added},
            total_spent = total_spent + ${Math.round(txn.amount_paise / 100)}
        WHERE id = ${txn.user_id}
        RETURNING balance
      `;

      await sql`
        INSERT INTO coin_logs (user_id, change, reason, reference, balance_after)
        VALUES (${txn.user_id}, ${txn.coins_added}, 'purchase', ${paymentId}, ${updated.rows[0].balance})
      `;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Webhook] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: false }
};
