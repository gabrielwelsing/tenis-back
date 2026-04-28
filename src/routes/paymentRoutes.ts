// =============================================================================
// PAYMENT ROUTES — Mercado Pago (PIX + Cartão recorrente)
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { MercadoPagoConfig, Payment, PreApproval } from 'mercadopago';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN ?? '',
});

const VALOR_PLANO = 14.90;

// ---------------------------------------------------------------------------
// POST /payment/criar — cria preferência PIX ou inicia assinatura cartão
// ---------------------------------------------------------------------------
router.post('/criar', async (req: Request, res: Response) => {
  const { user_id, email, tipo } = req.body;
  if (!user_id || !email || !tipo)
    return res.status(400).json({ error: 'user_id, email e tipo obrigatórios.' });

  try {
    if (tipo === 'pix') {
      const payment = new Payment(mp);
      const result  = await payment.create({
        body: {
          transaction_amount: VALOR_PLANO,
          description:        'Tenis Coach — Plano Mensal',
          payment_method_id:  'pix',
          payer:              { email },
        },
      });

      await pool.query(
        `INSERT INTO pagamentos (user_id, email, mp_payment_id, tipo, status, valor)
         VALUES ($1, $2, $3, 'pix', 'pending', $4)
         ON CONFLICT (mp_payment_id) DO NOTHING`,
        [user_id, email, String(result.id), VALOR_PLANO]
      );

      return res.json({
        tipo:        'pix',
        payment_id:  result.id,
        qr_code:     result.point_of_interaction?.transaction_data?.qr_code,
        qr_code_b64: result.point_of_interaction?.transaction_data?.qr_code_base64,
      });
    }

    if (tipo === 'cartao') {
      const preApproval = new PreApproval(mp);
      const result      = await preApproval.create({
        body: {
          reason:               'Tenis Coach — Plano Mensal',
          auto_recurring: {
            frequency:          1,
            frequency_type:     'months',
            transaction_amount: VALOR_PLANO,
            currency_id:        'BRL',
          },
          back_url: `${process.env.FRONTEND_URL ?? 'https://tenis-to.sup-ia.com'}/pagamento-retorno`,
          payer_email: email,
        },
      });

      await pool.query(
        `INSERT INTO pagamentos (user_id, email, mp_subscription_id, tipo, status, valor)
         VALUES ($1, $2, $3, 'cartao', 'pending', $4)
         ON CONFLICT (mp_subscription_id) DO NOTHING`,
        [user_id, email, result.id, VALOR_PLANO]
      );

      return res.json({
        tipo:      'cartao',
        init_point: result.init_point,
      });
    }

    return res.status(400).json({ error: 'tipo deve ser pix ou cartao.' });

  } catch (e: any) {
    console.error('[Payment criar]', e);
    return res.status(500).json({ error: 'Erro ao criar pagamento.' });
  }
});

// ---------------------------------------------------------------------------
// POST /payment/webhook — MP notifica pagamento aprovado
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  const { type, data } = req.body;
  console.log('[Webhook MP]', type, data);

  try {
    // Pagamento PIX aprovado
    if (type === 'payment' && data?.id) {
      const payment = new Payment(mp);
      const info    = await payment.get({ id: data.id });

      if (info.status === 'approved') {
        const pg = await pool.query(
          `SELECT * FROM pagamentos WHERE mp_payment_id = $1`,
          [String(info.id)]
        );

        if (pg.rows.length > 0) {
          const userId    = pg.rows[0].user_id;
          const hoje      = new Date();
          const proximoMes = new Date(hoje);
          proximoMes.setMonth(proximoMes.getMonth() + 1);

          await pool.query(
            `UPDATE pagamentos SET status='approved', plano_inicio=$1, plano_fim=$2, updated_at=NOW()
             WHERE mp_payment_id=$3`,
            [hoje.toISOString().split('T')[0], proximoMes.toISOString().split('T')[0], String(info.id)]
          );

          await pool.query(
            `UPDATE users SET role='aluno', plano_expira_em=$1 WHERE id=$2`,
            [proximoMes.toISOString().split('T')[0], userId]
          );

          console.log(`[Webhook] user ${userId} promovido para aluno até ${proximoMes.toISOString().split('T')[0]}`);
        }
      }
    }

    // Assinatura cartão aprovada/renovada
    if (type === 'subscription_preapproval' && data?.id) {
      const preApproval = new PreApproval(mp);
      const info        = await preApproval.get({ id: data.id });

      if (info.status === 'authorized') {
        const pg = await pool.query(
          `SELECT * FROM pagamentos WHERE mp_subscription_id = $1`,
          [String(info.id)]
        );

        if (pg.rows.length > 0) {
          const userId     = pg.rows[0].user_id;
          const hoje       = new Date();
          const proximoMes = new Date(hoje);
          proximoMes.setMonth(proximoMes.getMonth() + 1);

          await pool.query(
            `UPDATE pagamentos SET status='approved', plano_inicio=$1, plano_fim=$2, updated_at=NOW()
             WHERE mp_subscription_id=$3`,
            [hoje.toISOString().split('T')[0], proximoMes.toISOString().split('T')[0], String(info.id)]
          );

          await pool.query(
            `UPDATE users SET role='aluno', plano_expira_em=$1 WHERE id=$2`,
            [proximoMes.toISOString().split('T')[0], userId]
          );

          console.log(`[Webhook] assinatura user ${userId} renovada até ${proximoMes.toISOString().split('T')[0]}`);
        }
      }

      // Assinatura cancelada
      if (info.status === 'cancelled') {
        const pg = await pool.query(
          `SELECT * FROM pagamentos WHERE mp_subscription_id = $1`,
          [String(info.id)]
        );
        if (pg.rows.length > 0) {
          await pool.query(
            `UPDATE pagamentos SET status='cancelled', updated_at=NOW() WHERE mp_subscription_id=$1`,
            [String(info.id)]
          );
          await pool.query(
            `UPDATE users SET role='user', plano_expira_em=NULL WHERE id=$1`,
            [pg.rows[0].user_id]
          );
        }
      }
    }

  } catch (e) {
    console.error('[Webhook erro]', e);
  }

  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// GET /payment/status/:user_id — verifica status do plano
// ---------------------------------------------------------------------------
router.get('/status/:user_id', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT p.*, u.role, u.plano_expira_em
     FROM pagamentos p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC LIMIT 1`,
    [req.params.user_id]
  );
  if (!result.rows.length) return res.json({ ativo: false });
  const r = result.rows[0];
  res.json({
    ativo:      r.role === 'aluno',
    status:     r.status,
    tipo:       r.tipo,
    plano_fim:  r.plano_expira_em,
  });
});

export { router as paymentRouter };
