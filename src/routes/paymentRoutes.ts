// =============================================================================
// PAYMENT ROUTES — Stripe Payment Link
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VALOR_PLANO = 14.90;
const PLANO_DIAS = 30;

const STRIPE_PAYMENT_LINK =
  process.env.STRIPE_PAYMENT_LINK_URL ??
  'https://buy.stripe.com/9B67sLfF9eXvgVQgic5wI01';

function toDateOnly(data: Date) {
  return data.toISOString().split('T')[0];
}

function somarDias(data: Date, dias: number) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

async function ativarPlanoDireto(params: {
  userId: number;
  email: string;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
}) {
  const hoje = new Date();
  const fim = somarDias(hoje, PLANO_DIAS);

  if (params.stripeSessionId) {
    const existente = await pool.query(
      `SELECT id FROM pagamentos WHERE stripe_session_id = $1 LIMIT 1`,
      [params.stripeSessionId]
    );

    if (!existente.rows.length) {
      await pool.query(
        `INSERT INTO pagamentos
          (user_id, email, stripe_session_id, stripe_payment_intent_id, tipo, status, valor, plano_inicio, plano_fim, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, 'card', 'approved', $5, $6, $7, NOW(), NOW())`,
        [
          params.userId,
          params.email,
          params.stripeSessionId,
          params.stripePaymentIntentId ?? null,
          VALOR_PLANO,
          toDateOnly(hoje),
          toDateOnly(fim),
        ]
      );
    } else {
      await pool.query(
        `UPDATE pagamentos
         SET status = 'approved',
             stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
             plano_inicio = $2,
             plano_fim = $3,
             updated_at = NOW()
         WHERE stripe_session_id = $4`,
        [
          params.stripePaymentIntentId ?? null,
          toDateOnly(hoje),
          toDateOnly(fim),
          params.stripeSessionId,
        ]
      );
    }
  }

  await pool.query(
    `UPDATE users
     SET role = 'aluno',
         plano_expira_em = $1
     WHERE id = $2`,
    [toDateOnly(fim), params.userId]
  );

  console.log(
    `[Stripe Payment Link] user ${params.userId} promovido para aluno até ${toDateOnly(fim)}`
  );
}

// ---------------------------------------------------------------------------
// POST /payment/criar — gera link de pagamento Stripe com user_id e email
// ---------------------------------------------------------------------------
router.post('/criar', async (req: Request, res: Response) => {
  const { user_id, email } = req.body;

  if (!user_id || !email) {
    return res.status(400).json({ error: 'user_id e email obrigatórios.' });
  }

  try {
    const checkoutUrl =
      `${STRIPE_PAYMENT_LINK}` +
      `?client_reference_id=${encodeURIComponent(String(user_id))}` +
      `&prefilled_email=${encodeURIComponent(String(email))}`;

    return res.json({
      tipo: 'card',
      payment_id: null,
      session_id: null,
      checkout_url: checkoutUrl,
      init_point: checkoutUrl,
    });
  } catch (e: any) {
    console.error('[Payment criar Stripe Link]', e);
    return res.status(500).json({
      error: 'Erro ao gerar link de pagamento Stripe.',
      detalhe: e?.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /payment/webhook — Stripe avisa quando o pagamento foi concluído
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  console.log('[Webhook Stripe]', req.body?.type);

  try {
    const event = req.body;

    if (event?.type === 'checkout.session.completed') {
      const session = event.data?.object;

      const userId = Number(session?.client_reference_id);

      const email =
        session?.customer_details?.email ??
        session?.customer_email ??
        '';

      const stripeSessionId = session?.id ?? null;

      const stripePaymentIntentId =
        typeof session?.payment_intent === 'string'
          ? session.payment_intent
          : session?.payment_intent?.id ?? null;

      if (!userId || !email) {
        console.warn('[Webhook Stripe] user_id ou email ausente.', {
          userId,
          email,
          stripeSessionId,
        });

        return res.sendStatus(200);
      }

      if (session?.payment_status === 'paid') {
        await ativarPlanoDireto({
          userId,
          email,
          stripeSessionId,
          stripePaymentIntentId,
        });
      }
    }
  } catch (e) {
    console.error('[Webhook Stripe erro]', e);
  }

  return res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// GET /payment/status/:user_id — consulta status do plano
// ---------------------------------------------------------------------------
router.get('/status/:user_id', async (req: Request, res: Response) => {
  try {
    const userResult = await pool.query(
      `SELECT id, role, plano_expira_em
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.params.user_id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = userResult.rows[0];

    const pagamentoResult = await pool.query(
      `SELECT status, tipo, plano_fim
       FROM pagamentos
       WHERE user_id = $1
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [req.params.user_id]
    );

    const hoje = toDateOnly(new Date());
    const planoFim = user.plano_expira_em
      ? String(user.plano_expira_em).slice(0, 10)
      : null;

    const ativo =
      user.role === 'aluno' &&
      planoFim !== null &&
      planoFim >= hoje;

    return res.json({
      ativo,
      status: pagamentoResult.rows[0]?.status ?? null,
      tipo: pagamentoResult.rows[0]?.tipo ?? null,
      plano_fim: planoFim,
    });
  } catch (e) {
    console.error('[Payment status erro]', e);
    return res.status(500).json({ error: 'Erro ao consultar status do pagamento.' });
  }
});

export { router as paymentRouter };
