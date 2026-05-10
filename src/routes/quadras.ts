import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

function allStandardSlots(): string[] {
  return Array.from({ length: 32 }, (_, i) => {
    const total = 7 * 60 + i * 30;
    return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
  });
}

// GET /quadras/locais/todos
router.get('/locais/todos', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT l.*, COALESCE(json_agg(q ORDER BY q.id) FILTER (WHERE q.id IS NOT NULL), '[]') AS quadras
     FROM locais l LEFT JOIN quadras q ON q.local_id = l.id
     GROUP BY l.id ORDER BY l.id`
  );
  res.json(result.rows);
});

// GET /quadras/:id/slots?data=
router.get('/:id/slots', async (req: Request, res: Response) => {
  const quadraId = Number(req.params.id);
  const { data }  = req.query as Record<string, string>;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });

  const dow = new Date(data + 'T12:00:00').getDay();

  const slotsSemanais = await pool.query(
    `SELECT hora FROM quadra_slots_semanais WHERE quadra_id=$1 AND dia_semana=$2 ORDER BY hora`,
    [quadraId, dow]
  );
  if (!slotsSemanais.rows.length) return res.json({ slots: [] });

  const reservas = await pool.query(
    `SELECT hora_inicio, hora_fim, status FROM quadra_reservas
     WHERE quadra_id=$1 AND data=$2 AND status NOT IN ('cancelada')`,
    [quadraId, data]
  );

  const bloqueios = await pool.query(
    `SELECT hi_text, hf_text FROM quadra_bloqueios WHERE quadra_id=$1 AND data=$2`,
    [quadraId, data]
  );

  const fixos = await pool.query(
    `SELECT hora_inicio, hora_fim FROM agenda_horarios_fixos
     WHERE nome IS NOT NULL AND ativo=true AND dia_semana=$1
       AND (valido_de IS NULL OR valido_de::date <= $2::date)
       AND (valido_ate IS NULL OR valido_ate::date >= $2::date)`,
    [dow, data]
  );

  const slots = slotsSemanais.rows.map((s: any) => {
    const hora = s.hora;

    const isBloqueado = bloqueios.rows.some((b: any) => {
      const hi = (b.hi_text || '00:00').slice(0, 5);
      const hf = (b.hf_text || '23:59').slice(0, 5);
      return hora >= hi && hora < hf;
    });
    if (isBloqueado) return { hora_inicio: hora, status: 'bloqueado' };

    const isFixo = fixos.rows.some((f: any) => {
      const fHi = String(f.hora_inicio).slice(0, 5);
      const fHf = String(f.hora_fim).slice(0, 5);
      return hora >= fHi && hora < fHf;
    });
    if (isFixo) return { hora_inicio: hora, status: 'bloqueado' };

    const reservasSlot = reservas.rows.filter((r: any) => {
      const rHi = String(r.hora_inicio).slice(0, 5);
      const rHf = String(r.hora_fim).slice(0, 5);
      return hora >= rHi && hora < rHf;
    });
    if (reservasSlot.some((r: any) => r.status === 'confirmada'))  return { hora_inicio: hora, status: 'confirmada' };
    if (reservasSlot.some((r: any) => r.status === 'fila_espera')) return { hora_inicio: hora, status: 'fila_espera' };
    if (reservasSlot.length > 0)                                   return { hora_inicio: hora, status: 'pendente' };

    return { hora_inicio: hora, status: 'livre' };
  });

  res.json({ slots });
});

// GET /quadras/:id/slots-semanais
router.get('/:id/slots-semanais', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_slots_semanais WHERE quadra_id=$1 ORDER BY dia_semana, hora`,
    [Number(req.params.id)]
  );
  res.json(result.rows);
});

// POST /quadras/slots-semanais — add single slot
router.post('/slots-semanais', async (req: Request, res: Response) => {
  const { quadra_id, dia_semana, hora } = req.body;
  if (!quadra_id || dia_semana === undefined || !hora)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  try {
    const result = await pool.query(
      `INSERT INTO quadra_slots_semanais (quadra_id, dia_semana, hora) VALUES ($1,$2,$3) RETURNING *`,
      [quadra_id, dia_semana, hora]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slot já existe.' });
    throw e;
  }
});

// POST /quadras/slots-semanais/bulk — restore all standard slots for a day
router.post('/slots-semanais/bulk', async (req: Request, res: Response) => {
  const { quadra_id, dia_semana } = req.body;
  if (!quadra_id || dia_semana === undefined)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  for (const hora of allStandardSlots()) {
    await pool.query(
      `INSERT INTO quadra_slots_semanais (quadra_id, dia_semana, hora) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [quadra_id, dia_semana, hora]
    );
  }
  res.json({ ok: true });
});

// DELETE /quadras/slots-semanais/:id
router.delete('/slots-semanais/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM quadra_slots_semanais WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// GET /quadras/:id/disponibilidade/config (mantido para compatibilidade)
router.get('/:id/disponibilidade/config', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_disponibilidade WHERE quadra_id=$1 ORDER BY id DESC LIMIT 1`,
    [Number(req.params.id)]
  );
  res.json(result.rows);
});

// POST /quadras/disponibilidade (mantido para compatibilidade)
router.post('/disponibilidade', async (req: Request, res: Response) => {
  const { quadra_id, dias_semana, hi_text, hf_text } = req.body;
  if (!quadra_id) return res.status(400).json({ error: 'quadra_id obrigatório.' });
  const result = await pool.query(
    `INSERT INTO quadra_disponibilidade (quadra_id, dias_semana, hi_text, hf_text)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (quadra_id) DO UPDATE SET dias_semana=$2, hi_text=$3, hf_text=$4
     RETURNING *`,
    [quadra_id, dias_semana, hi_text, hf_text]
  );
  res.json(result.rows[0]);
});

// GET /quadras/:id/reservas/admin
router.get('/:id/reservas/admin', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_reservas WHERE quadra_id=$1 AND status NOT IN ('cancelada')
     ORDER BY data DESC, hora_inicio`,
    [Number(req.params.id)]
  );
  res.json(result.rows);
});

// POST /quadras/reservas
router.post('/reservas', async (req: Request, res: Response) => {
  const { quadra_id, email_aluno, nome_reserva, whatsapp, data, hora_inicio, hora_fim } = req.body;
  if (!quadra_id || !nome_reserva || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const dow = new Date(data + 'T12:00:00').getDay();

  // Valida que hora_inicio está nos slots semanais
  const slotValido = await pool.query(
    `SELECT id FROM quadra_slots_semanais WHERE quadra_id=$1 AND dia_semana=$2 AND hora=$3`,
    [quadra_id, dow, hora_inicio]
  );
  if (!slotValido.rows.length)
    return res.status(400).json({ error: 'Horário não disponível para esta quadra.' });

  // Verifica bloqueio
  const bloqueio = await pool.query(
    `SELECT id FROM quadra_bloqueios WHERE quadra_id=$1 AND data=$2 AND hi_text<=$3 AND hf_text>$3`,
    [quadra_id, data, hora_inicio]
  );
  if (bloqueio.rows.length) return res.status(409).json({ error: 'Horário bloqueado.' });

  // Verifica conflito com horário fixo de aula
  const fixoConflito = await pool.query(
    `SELECT id FROM agenda_horarios_fixos
     WHERE nome IS NOT NULL AND ativo=true AND dia_semana=$1
       AND (valido_de IS NULL OR valido_de::date <= $2::date)
       AND (valido_ate IS NULL OR valido_ate::date >= $2::date)
       AND hora_inicio::time <= $3::time AND hora_fim::time > $3::time`,
    [dow, data, hora_inicio]
  );
  if (fixoConflito.rows.length)
    return res.status(409).json({ error: 'Horário reservado para aula do professor.' });

  // Verifica conflito com reservas existentes
  const conflito = await pool.query(
    `SELECT id FROM quadra_reservas
     WHERE quadra_id=$1 AND data=$2 AND status IN ('confirmada','pendente')
       AND hora_inicio < $4 AND hora_fim > $3`,
    [quadra_id, data, hora_inicio, hora_fim]
  );
  const fila = conflito.rows.length > 0;

  const result = await pool.query(
    `INSERT INTO quadra_reservas (quadra_id, email_aluno, nome_reserva, whatsapp, data, hora_inicio, hora_fim, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [quadra_id, email_aluno || null, nome_reserva, whatsapp || null, data,
     hora_inicio, hora_fim, fila ? 'fila_espera' : 'pendente']
  );
  res.status(201).json({ ...result.rows[0], fila });
});

// PATCH /quadras/reservas/:id/confirmar
router.patch('/reservas/:id/confirmar', async (req: Request, res: Response) => {
  const result = await pool.query(
    `UPDATE quadra_reservas SET status='confirmada', confirmado_admin=true WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Reserva não encontrada.' });
  res.json(result.rows[0]);
});

// PATCH /quadras/reservas/:id/cancelar
router.patch('/reservas/:id/cancelar', async (req: Request, res: Response) => {
  const r = await pool.query(`SELECT * FROM quadra_reservas WHERE id=$1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const reserva = r.rows[0];

  await pool.query(`UPDATE quadra_reservas SET status='cancelada' WHERE id=$1`, [req.params.id]);

  const proximo = await pool.query(
    `SELECT * FROM quadra_reservas
     WHERE quadra_id=$1 AND data=$2 AND hora_inicio=$3 AND status='fila_espera'
     ORDER BY created_at LIMIT 1`,
    [reserva.quadra_id, reserva.data, reserva.hora_inicio]
  );
  if (proximo.rows.length) {
    await pool.query(`UPDATE quadra_reservas SET status='pendente' WHERE id=$1`, [proximo.rows[0].id]);
  }
  res.json({ ok: true });
});

// POST /quadras/bloqueios
router.post('/bloqueios', async (req: Request, res: Response) => {
  const { quadra_id, data, hi_text, hf_text, motivo } = req.body;
  if (!quadra_id || !data || !hi_text || !hf_text)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  const result = await pool.query(
    `INSERT INTO quadra_bloqueios (quadra_id, data, hi_text, hf_text, motivo)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [quadra_id, data, hi_text, hf_text, motivo || null]
  );
  res.status(201).json(result.rows[0]);
});

// GET /quadras/:id/bloqueios
router.get('/:id/bloqueios', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT * FROM quadra_bloqueios WHERE quadra_id=$1 ORDER BY data DESC, hi_text`,
    [Number(req.params.id)]
  );
  res.json(result.rows);
});

// DELETE /quadras/bloqueios/:id
router.delete('/bloqueios/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM quadra_bloqueios WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

export { router as quadrasRouter };
