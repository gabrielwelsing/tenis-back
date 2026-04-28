// =============================================================================
// AGENDA ROUTER — Horários do admin + inscrições dos alunos
// Padrão: raw pg.Pool (igual ao authRoutes)
// Isolamento: cada admin vê apenas seus próprios slots
// Alunos: qualquer usuário pode ver e se inscrever
// Admin deve confirmar inscrições de alunos
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// GET /agenda/slots?admin_email=&data=YYYY-MM-DD
// Retorna slots do admin para a data (alunos também usam esta rota)
// ---------------------------------------------------------------------------
router.get('/slots', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const hoje = new Date().toISOString().split('T')[0];
  const dataFiltro = data || hoje;

  const result = await pool.query(
    `SELECT s.*,
            COALESCE(
              json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]'
            ) AS inscricoes
     FROM agenda_slots s
     LEFT JOIN agenda_inscricoes i ON i.slot_id = s.id AND i.status != 'cancelada'
     WHERE s.admin_email = $1
       AND s.data = $2
       AND s.status = 'ativo'
       AND s.tipo != 'bloqueado'
     GROUP BY s.id
     ORDER BY s.hora_inicio`,
    [admin_email, dataFiltro]
  );
  res.json(result.rows);
});

// GET /agenda/slots/admin?admin_email=&data= — inclui bloqueados (visão admin)
router.get('/slots/admin', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const hoje = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT s.*,
            COALESCE(
              json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]'
            ) AS inscricoes
     FROM agenda_slots s
     LEFT JOIN agenda_inscricoes i ON i.slot_id = s.id AND i.status != 'cancelada'
     WHERE s.admin_email = $1
       AND s.data = $2
       AND s.status = 'ativo'
     GROUP BY s.id
     ORDER BY s.hora_inicio`,
    [admin_email, data || hoje]
  );
  res.json(result.rows);
});

// ---------------------------------------------------------------------------
// POST /agenda/slots — admin cria ou atualiza slot
// ---------------------------------------------------------------------------
router.post('/slots', async (req: Request, res: Response) => {
  const {
    admin_email, data, hora_inicio, hora_fim,
    tipo, vagas, periodicity, observacao,
  } = req.body;

  if (!admin_email || !data || !hora_inicio || !hora_fim || !tipo)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  // Verifica se já existe slot para esse admin/data/hora
  const exists = await pool.query(
    `SELECT id FROM agenda_slots WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
    [admin_email, data, hora_inicio]
  );

  let result;
  if (exists.rows.length > 0) {
    result = await pool.query(
      `UPDATE agenda_slots SET tipo=$1, vagas=$2, periodicity=$3, observacao=$4
       WHERE id=$5 RETURNING *`,
      [tipo, vagas ?? 1, periodicity ?? 'unico', observacao ?? null, exists.rows[0].id]
    );
  } else {
    result = await pool.query(
      `INSERT INTO agenda_slots (admin_email, data, hora_inicio, hora_fim, tipo, vagas, periodicity, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [admin_email, data, hora_inicio, hora_fim, tipo, vagas ?? 1, periodicity ?? 'unico', observacao ?? null]
    );
  }
  res.status(201).json(result.rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /agenda/slots/:id — admin remove/bloqueia slot
// ---------------------------------------------------------------------------
router.delete('/slots/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_slots SET status='cancelado' WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /agenda/slots/:id/inscrever — aluno se inscreve (fica pendente)
// ---------------------------------------------------------------------------
router.post('/slots/:id/inscrever', async (req: Request, res: Response) => {
  const { email_aluno, nome_aluno, recorrencia } = req.body;
  if (!email_aluno || !nome_aluno)
    return res.status(400).json({ error: 'email_aluno e nome_aluno obrigatórios.' });

  const slot = await pool.query(`SELECT * FROM agenda_slots WHERE id=$1 AND status='ativo'`, [req.params.id]);
  if (!slot.rows.length) return res.status(404).json({ error: 'Slot não encontrado.' });
  const s = slot.rows[0];

  if (s.vagas_ocupadas >= s.vagas)
    return res.status(409).json({ error: 'Sem vagas disponíveis.' });

  try {
    const inscricao = await pool.query(
      `INSERT INTO agenda_inscricoes (slot_id, email_aluno, nome_aluno, recorrencia)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, email_aluno, nome_aluno, recorrencia ?? 'unico']
    );
    await pool.query(
      `UPDATE agenda_slots SET vagas_ocupadas = vagas_ocupadas + 1 WHERE id=$1`,
      [req.params.id]
    );
    res.status(201).json(inscricao.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Aluno já inscrito neste horário.' });
    throw e;
  }
});

// ---------------------------------------------------------------------------
// GET /agenda/confirmacoes?admin_email= — admin vê inscrições pendentes
// ---------------------------------------------------------------------------
router.get('/confirmacoes', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const result = await pool.query(
    `SELECT i.*, s.data, s.hora_inicio, s.hora_fim, s.tipo
     FROM agenda_inscricoes i
     JOIN agenda_slots s ON s.id = i.slot_id
     WHERE s.admin_email = $1
       AND i.status = 'pendente'
     ORDER BY s.data, s.hora_inicio`,
    [admin_email]
  );
  res.json(result.rows);
});

// ---------------------------------------------------------------------------
// PATCH /agenda/inscricoes/:id/confirmar — admin confirma ou rejeita
// ---------------------------------------------------------------------------
router.patch('/inscricoes/:id/confirmar', async (req: Request, res: Response) => {
  const { confirmar } = req.body; // true = confirmar, false = rejeitar
  const novoStatus = confirmar ? 'confirmada' : 'cancelada';

  const result = await pool.query(
    `UPDATE agenda_inscricoes
     SET status=$1, confirmado_admin=true
     WHERE id=$2 RETURNING *`,
    [novoStatus, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Inscrição não encontrada.' });

  if (!confirmar) {
    // Libera a vaga se rejeitou
    await pool.query(
      `UPDATE agenda_slots SET vagas_ocupadas = GREATEST(0, vagas_ocupadas - 1)
       WHERE id = $1`,
      [result.rows[0].slot_id]
    );
  }
  res.json(result.rows[0]);
});

// ---------------------------------------------------------------------------
// DELETE /agenda/inscricoes/:id — aluno cancela própria inscrição
// ---------------------------------------------------------------------------
router.delete('/inscricoes/:id', async (req: Request, res: Response) => {
  const result = await pool.query(
    `UPDATE agenda_inscricoes SET status='cancelada' WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Inscrição não encontrada.' });
  await pool.query(
    `UPDATE agenda_slots SET vagas_ocupadas = GREATEST(0, vagas_ocupadas - 1) WHERE id=$1`,
    [result.rows[0].slot_id]
  );
  res.json({ ok: true });
});

export { router as agendaRouter };
