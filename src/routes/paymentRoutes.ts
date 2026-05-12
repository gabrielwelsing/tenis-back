// =============================================================================
// PAYMENT ROUTES — Stripe PIX
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import Stripe from 'stripe';

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VALOR_PLANO = 14.90;
const VALOR_PLANO_CENTAVOS = 1490;
const PLANO_DIAS = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-12-18.acacia',
});

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://tenis-to.sup-ia.com';

function toDateOnly(data: Date) {
  return data.toISOString().split('T')[0];
}

function somarDias(data: Date, dias: number) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

async function ativarPlanoPorPagamentoId(pagamentoId: number) {
  const hoje = new Date();
  const fim = somarDias(hoje, PLANO_DIAS);

  const pg = await pool.query(
    `SELECT user_id FROM pagamentos WHERE id = $1`,
    [pagamentoId]
  );

  if (!pg.rows.length) return;

  await pool.query(
    `UPDATE pagamentos
     SET status = 'approved',
         plano_inicio = $1,
         plano_fim = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [toDateOnly(hoje), toDateOnly(fim), pagamentoId]
  );

  await pool.query(
    `UPDATE users
     SET role = 'aluno',
         plano_expira_em = $1
     WHERE id = $2`,
    [toDateOnly(fim), pg.rows[0].user_id]
  );

  console.log(
    `[Stripe PIX] user ${pg.rows[0].user_id} promovido para aluno até ${toDateOnly(fim)}`
  );
}

async function ativarPlanoPorStripeSessionId(sessionId: string, paymentIntentId?: string | null) {
  const pg = await pool.query(
    `SELECT id FROM pagamentos WHERE stripe_session_id = $1`,
    [sessionId]
  );

  if (!pg.rows.length) {
    console.warn(`[Stripe PIX] pagamento não encontrado para session ${sessionId}`);
    return;
  }

  if (paymentIntentId) {
    await pool.query(
      `UPDATE pagamentos
       SET stripe_payment_intent_id = $1,
           updated_at = NOW()
       WHERE stripe_session_id = $2`,
      [paymentIntentId, sessionId]
    );
  }

  await ativarPlanoPorPagamentoId(pg.rows[0].id);
}

// ---------------------------------------------------------------------------
// POST /payment/criar — cria checkout Stripe PIX
// ---------------------------------------------------------------------------
router.post('/criar', async (req: Request, res: Response) => {
  const { user_id, email, tipo } = req.body;

  if (!user_id || !email) {
    return res.status(400).json({ error: 'user_id e email obrigatórios.' });
  }

  if (tipo && tipo !== 'pix') {
    return res.status(400).json({ error: 'Somente pagamento via pix está disponível.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY não configurada.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['pix'],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: VALOR_PLANO_CENTAVOS,
            product_data: {
              name: 'Tênis Coach — Plano Mensal',
              description: 'Acesso mensal ao app Tênis Coach com Carlão',
            },
          },
        },
      ],
      metadata: {
        user_id: String(user_id),
        email: String(email),
        tipo: 'pix',
      },
      success_url: `${FRONTEND_URL}/pagamento-retorno?status=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/pagamento-retorno?status=cancelado`,
    });

    await pool.query(
      `INSERT INTO pagamentos
        (user_id, email, stripe_session_id, tipo, status, valor)
       VALUES
        ($1, $2, $3, 'pix', 'pending', $4)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [user_id, email, session.id, VALOR_PLANO]
    );

    return res.json({
      tipo: 'pix',
      payment_id: session.id,
      session_id: session.id,
      checkout_url: session.url,
      init_point: session.url,
    });
  } catch (e: any) {
    console.error('[Payment criar Stripe]', e);
    return res.status(500).json({
      error: 'Erro ao criar pagamento PIX na Stripe.',
      detalhe: e?.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /payment/webhook — Stripe notifica pagamento aprovado
// OBS: depois vamos configurar o webhook no painel da Stripe.
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  console.log('[Webhook Stripe]', req.body?.type);

  try {
    const event = req.body;

    if (event?.type === 'checkout.session.completed') {
      const session = event.data?.object as Stripe.Checkout.Session;

      if (session?.id && session?.payment_status === 'paid') {
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null;

        await ativarPlanoPorStripeSessionId(session.id, paymentIntentId);
      }
    }
  } catch (e) {
    console.error('[Webhook Stripe erro]', e);
  }

  return res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// GET /payment/status/:user_id — verifica status do plano
// Se último PIX estiver pendente, consulta a Stripe e corrige se já foi pago.
// ---------------------------------------------------------------------------
router.get('/status/:user_id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.role, u.plano_expira_em
       FROM pagamentos p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [req.params.user_id]
    );

    if (!result.rows.length) {
      return res.json({ ativo: false });
    }

    const r = result.rows[0];

    if (r.status === 'pending' && r.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(r.stripe_session_id);

        if (session.payment_status === 'paid') {
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null;

          await ativarPlanoPorStripeSessionId(session.id, paymentIntentId);

          const atualizado = await pool.query(
            `SELECT p.*, u.role, u.plano_expira_em
             FROM pagamentos p
             JOIN users u ON u.id = p.user_id
             WHERE p.id = $1
             LIMIT 1`,
            [r.id]
          );

          const a = atualizado.rows[0];

          return res.json({
            ativo: a.role === 'aluno',
            status: a.status,
            tipo: a.tipo,
            plano_fim: a.plano_expira_em,
          });
        }
      } catch (e) {
        console.error('[Status Stripe consulta erro]', e);
      }
    }

    return res.json({
      ativo: r.role === 'aluno',
      status: r.status,
      tipo: r.tipo,
      plano_fim: r.plano_expira_em,
    });
  } catch (e) {
    console.error('[Payment status erro]', e);
    return res.status(500).json({ error: 'Erro ao consultar status do pagamento.' });
  }
});

export { router as paymentRouter };
