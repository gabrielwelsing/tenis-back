// =============================================================================
// QUADRAS ROUTER — v2
// Locais, disponibilidade, slots, reservas (aprovação + fila), bloqueios
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────

function gerarSlots30(hi: string, hf: string): string[] {
  const [sh, sm] = hi.split(':').map(Number);
  const [eh, em] = hf.split(':').map(Number);
  const slots: string[] = [];
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  while (cur < end) {
    slots.push(`${String(Math.floor(cur / 60)).padStart(2,'0')}:${String(cur % 60).padStart(2,'0')}`);
    cur += 30;
  }
  return slots;
}

function intToTime(h: number): string {
  return `${String(h).padStart(2,'0')}:00`;
}

// =============================================================================
// LOCAIS
// =============================================================================

// GET /quadras/locais/todos — público
router.get('/locais/todos', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.nome, l.endereco, l.observacao, l.socios_only,
              COALESCE(json_agg(
                json_build_object('id',q.id,'nome',q.nome,'preco_hora',q.preco_hora)
              ) FILTER (WHERE q.id IS NOT NULL), '[]') AS quadras
       FROM locais l
       LEFT JOIN quadras q ON q.local_id = l.id AND q.ativa = true
       WHERE l.ativo = true
       GROUP BY l.id ORDER BY l.id`
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar locais.' }); }
});

// GET /quadras/locais — admin
router.get('/locais', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const result = await pool.query(
    `SELECT l.*,
            COALESCE(json_agg(q.*) FILTER (WHERE q.id IS NOT NULL), '[]') AS quadras
     FROM locais l
     LEFT JOIN quadras q ON q.local_id = l.id AND q.ativa = true
     WHERE l.admin_email = $1 AND l.ativo = true
     GROUP BY l.id ORDER BY l.created_at`,
    [admin_email]
  );
  res.json(result.rows);
});

// POST /quadras/locais
router.post('/locais', async (req: Request, res: Response) => {
  const { admin_email, nome, endereco, observacao, socios_only } = req.body;
  if (!admin_email || !nome) return res.status(400).json({ error: 'admin_email e nome obrigatórios.' });
  const result = await pool.query(
    `INSERT INTO locais (admin_email, nome, endereco, observacao, socios_only)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [admin_email, nome, endereco ?? null, observacao ?? null, socios_only ?? false]
  );
  res.status(201).json(result.rows[0]);
});

// =============================================================================
// DISPONIBILIDADE
// =============================================================================

// GET /quadras/:id/disponibilidade/config — config atual (ANTES do genérico)
router.get('/:id/disponibilidade/config', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_disponibilidade WHERE quadra_id=$1`,
    [req.params.id]
  );
  res.json(result.rows);
});

// POST /quadras/disponibilidade — admin salva
router.post('/disponibilidade', async (req: Request, res: Response) => {
  const { quadra_id, dias_semana, hi_text, hf_text } = req.body;
  if (!quadra_id || !dias_semana || !hi_text || !hf_text)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const hora_inicio = parseInt(hi_text.split(':')[0]);
  const hora_fim    = parseInt(hf_text.split(':')[0]);

  await pool.query(`DELETE FROM quadra_disponibilidade WHERE quadra_id=$1`, [quadra_id]);
  const result = await pool.query(
    `INSERT INTO quadra_disponibilidade (quadra_id, dias_semana, hora_inicio, hora_fim)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [quadra_id, dias_semana, hora_inicio, hora_fim]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /quadras/disponibilidade/:id
router.delete('/disponibilidade/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM quadra_disponibilidade WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// =============================================================================
// SLOTS — visualização 30min para uma data
// =============================================================================

// GET /quadras/:id/slots?data=YYYY-MM-DD
router.get('/:id/slots', async (req: Request, res: Response) => {
  try {
    const { data } = req.query as Record<string, string>;
    if (!data) return res.status(400).json({ error: 'data obrigatória.' });

    const dow = new Date(data + 'T12:00:00').getDay();

    const disp = await pool.query(
      `SELECT * FROM quadra_disponibilidade WHERE quadra_id=$1 AND $2 = ANY(dias_semana)`,
      [req.params.id, dow]
    );

    if (!disp.rows.length) return res.json({ disponivel: false, slots: [] });

    const row = disp.rows[0];
    const hi  = intToTime(row.hora_inicio);
    const hf  = intToTime(row.hora_fim);
    if (!hi || !hf) return res.json({ disponivel: false, slots: [] });

    const todosSlots = gerarSlots30(hi, hf);

    const [reservas, bloqueios] = await Promise.all([
      pool.query(
        `SELECT hora_inicio, hora_fim, status FROM quadra_reservas
         WHERE quadra_id=$1 AND data=$2 AND status NOT IN ('cancelada')`,
        [req.params.id, data]
      ),
      pool.query(
        `SELECT hora_inicio, hora_fim FROM quadra_bloqueios
         WHERE quadra_id=$1 AND data=$2`,
        [req.params.id, data]
      ),
    ]);

    const slotStatus: Record<string, string> = {};

    bloqueios.rows.forEach(b => {
      const bHi = intToTime(b.hora_inicio);
      const bHf = intToTime(b.hora_fim);
      if (bHi && bHf) gerarSlots30(bHi, bHf).forEach(s => { slotStatus[s] = 'bloqueado'; });
    });

    reservas.rows.forEach(r => {
      if (!r.hora_inicio || !r.hora_fim) return;
      gerarSlots30(r.hora_inicio, r.hora_fim).forEach(s => {
        if (!slotStatus[s]) slotStatus[s] = r.status;
      });
    });

    // ── Agenda do Carlão também ocupa a quadra ───────────────────────────────
    const localRow = await pool.query(
      `SELECT l.admin_email FROM locais l
       JOIN quadras q ON q.local_id = l.id
       WHERE q.id = $1`,
      [req.params.id]
    );
    if (localRow.rows.length) {
      const adminEmail = localRow.rows[0].admin_email;

      // 1) Reservas de aula confirmadas por alunos
      const aulas = await pool.query(
        `SELECT hora_inicio::text, hora_fim::text
         FROM agenda_inscricoes
         WHERE admin_email = $1 AND data = $2 AND status = 'confirmada'`,
        [adminEmail, data]
      );
      aulas.rows.forEach(a => {
        if (!a.hora_inicio || !a.hora_fim) return;
        gerarSlots30(a.hora_inicio.slice(0, 5), a.hora_fim.slice(0, 5))
          .forEach(s => { if (!slotStatus[s]) slotStatus[s] = 'confirmada'; });
      });

      // 2) Horários fixos semanais (agenda_horarios_fixos) — independente de ter aluno confirmado
      const fixos = await pool.query(
        `SELECT hora_inicio::text, hora_fim::text
         FROM agenda_horarios_fixos
         WHERE admin_email = $1
           AND dia_semana  = $2
           AND ativo       = true
           AND (valido_de  IS NULL OR valido_de::date  <= $3::date)
           AND (valido_ate IS NULL OR valido_ate::date >= $3::date)`,
        [adminEmail, dow, data]
      );

      // Slots cancelados neste dia específico via override
      const overrides = await pool.query(
        `SELECT hora_inicio::text FROM agenda_slot_override
         WHERE admin_email = $1 AND data = $2 AND status = 'cancelado'`,
        [adminEmail, data]
      );
      const cancelados = new Set(
        overrides.rows.map((o: any) => (o.hora_inicio ?? '').slice(0, 5))
      );

      fixos.rows.forEach(f => {
        if (!f.hora_inicio || !f.hora_fim) return;
        if (cancelados.has(f.hora_inicio.slice(0, 5))) return;
        gerarSlots30(f.hora_inicio.slice(0, 5), f.hora_fim.slice(0, 5))
          .forEach(s => { if (!slotStatus[s]) slotStatus[s] = 'confirmada'; });
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const result = todosSlots.map(s => ({
      hora_inicio: s,
      status: slotStatus[s] || 'livre',
    }));

    res.json({ disponivel: true, slots: result, hi, hf });
  } catch (e) {
    console.error('[GET /:id/slots]', e);
    res.status(500).json({ error: 'Erro ao carregar slots.' });
  }
});

// =============================================================================
// RESERVAS
// =============================================================================

// GET /quadras/:id/reservas/admin — admin vê tudo (ANTES do genérico)
router.get('/:id/reservas/admin', async (req: Request, res: Response) => {
  const { data } = req.query as Record<string, string>;
  const where  = data ? 'AND data=$2' : '';
  const params: unknown[] = data ? [req.params.id, data] : [req.params.id];
  const result = await pool.query(
    `SELECT * FROM quadra_reservas
     WHERE quadra_id=$1 ${where} AND status != 'cancelada'
     ORDER BY data, hora_inicio`,
    params
  );
  res.json(result.rows);
});

// GET /quadras/:id/reservas/pendentes
router.get('/:id/reservas/pendentes', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_reservas WHERE quadra_id=$1 AND status='pendente' ORDER BY created_at`,
    [req.params.id]
  );
  res.json(result.rows);
});

// POST /quadras/reservas — solicitar ou entrar na fila
router.post('/reservas', async (req: Request, res: Response) => {
  const { quadra_id, email_aluno, nome_reserva, whatsapp, data, hora_inicio, hora_fim } = req.body;
  if (!quadra_id || !nome_reserva || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const conflito = await pool.query(
    `SELECT id FROM quadra_reservas
     WHERE quadra_id=$1 AND data=$2
       AND status IN ('pendente','confirmada')
       AND hora_inicio < $4 AND hora_fim > $3`,
    [quadra_id, data, hora_inicio, hora_fim]
  );

  const status = conflito.rows.length > 0 ? 'fila_espera' : 'pendente';
  const hora   = parseInt(hora_inicio.split(':')[0]);

  const result = await pool.query(
    `INSERT INTO quadra_reservas
       (quadra_id, email_aluno, nome_reserva, whatsapp, data, hora, hora_inicio, hora_fim, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [quadra_id, email_aluno ?? null, nome_reserva, whatsapp ?? null, data, hora, hora_inicio, hora_fim, status]
  );

  res.status(201).json({ ...result.rows[0], fila: status === 'fila_espera' });
});

// PATCH /quadras/reservas/:id/confirmar — admin confirma
router.patch('/reservas/:id/confirmar', async (req: Request, res: Response) => {
  const result = await pool.query(
    `UPDATE quadra_reservas SET status='confirmada', confirmado_admin=true WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Reserva não encontrada.' });
  res.json(result.rows[0]);
});

// PATCH /quadras/reservas/:id/cancelar — admin cancela e promove fila
router.patch('/reservas/:id/cancelar', async (req: Request, res: Response) => {
  const result = await pool.query(
    `UPDATE quadra_reservas SET status='cancelada' WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const r = result.rows[0];
  if (r.hora_inicio && r.hora_fim) {
    await pool.query(
      `UPDATE quadra_reservas SET status='pendente'
       WHERE id = (
         SELECT id FROM quadra_reservas
         WHERE quadra_id=$1 AND data=$2 AND status='fila_espera'
           AND hora_inicio < $4 AND hora_fim > $3
         ORDER BY created_at LIMIT 1
       )`,
      [r.quadra_id, r.data, r.hora_inicio, r.hora_fim]
    );
  }

  res.json({ ok: true });
});

// =============================================================================
// BLOQUEIOS
// =============================================================================

// POST /quadras/bloqueios
router.post('/bloqueios', async (req: Request, res: Response) => {
  const { quadra_id, data, hi_text, hf_text, motivo } = req.body;
  if (!quadra_id || !data || !hi_text || !hf_text)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const hora_inicio = parseInt(hi_text.split(':')[0]);
  const hora_fim    = parseInt(hf_text.split(':')[0]);

  const result = await pool.query(
    `INSERT INTO quadra_bloqueios (quadra_id, data, hora_inicio, hora_fim, motivo)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [quadra_id, data, hora_inicio, hora_fim, motivo ?? null]
  );
  res.status(201).json(result.rows[0]);
});

// GET /quadras/:id/bloqueios?data=
router.get('/:id/bloqueios', async (req: Request, res: Response) => {
  const { data }  = req.query as Record<string, string>;
  const where     = data ? 'AND data=$2' : '';
  const params: unknown[] = data ? [req.params.id, data] : [req.params.id];
  const result = await pool.query(
    `SELECT * FROM quadra_bloqueios WHERE quadra_id=$1 ${where} ORDER BY data, hora_inicio`,
    params
  );
  res.json(result.rows);
});

// DELETE /quadras/bloqueios/:id
router.delete('/bloqueios/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM quadra_bloqueios WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// =============================================================================
// QUADRAS CRUD (mantido do original)
// =============================================================================

router.post('/', async (req: Request, res: Response) => {
  const { local_id, nome, preco_hora } = req.body;
  if (!local_id || !nome) return res.status(400).json({ error: 'local_id e nome obrigatórios.' });
  const result = await pool.query(
    `INSERT INTO quadras (local_id, nome, preco_hora) VALUES ($1,$2,$3) RETURNING *`,
    [local_id, nome, preco_hora ?? 0]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { nome, preco_hora } = req.body;
  const result = await pool.query(
    `UPDATE quadras SET nome=$1, preco_hora=$2 WHERE id=$3 RETURNING *`,
    [nome, preco_hora ?? 0, req.params.id]
  );
  res.json(result.rows[0]);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await pool.query(`UPDATE quadras SET ativa=false WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

export { router as quadrasRouter };
