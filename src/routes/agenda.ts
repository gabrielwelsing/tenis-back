import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// GET /agenda/admin-info — busca email e telefone do admin
router.get('/admin-info', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT email, telefone FROM users WHERE role = 'admin' LIMIT 1`
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Admin não encontrado.' });
  res.json(result.rows[0]);
});

// GET /agenda/slots?admin_email=&data=YYYY-MM-DD — visão aluno (exclui ocupado e bloqueado)
router.get('/slots', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const hoje = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email = $1 AND data = $2 AND status = 'ativo' AND tipo != 'bloqueado'
     ORDER BY hora_inicio`,
    [admin_email, data || hoje]
  );
  res.json(result.rows);
});

// GET /agenda/slots/admin?admin_email=&data= — visão admin (tudo exceto cancelado)
router.get('/slots/admin', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const hoje = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email = $1 AND data = $2 AND status != 'cancelado'
     ORDER BY hora_inicio`,
    [admin_email, data || hoje]
  );
  res.json(result.rows);
});

// POST /agenda/slots — admin cria slot
router.post('/slots', async (req: Request, res: Response) => {
  const { admin_email, data, hora_inicio, hora_fim, tipo, vagas, observacao } = req.body;
  if (!admin_email || !data || !hora_inicio || !hora_fim || !tipo)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const exists = await pool.query(
    `SELECT id FROM agenda_slots WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status != 'cancelado'`,
    [admin_email, data, hora_inicio]
  );
  if (exists.rows.length > 0)
    return res.status(409).json({ error: 'Já existe um horário neste dia e hora.' });

  const result = await pool.query(
    `INSERT INTO agenda_slots (admin_email, data, hora_inicio, hora_fim, tipo, vagas, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [admin_email, data, hora_inicio, hora_fim, tipo, vagas ?? 1, observacao ?? null]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /agenda/slots/:id/ocupado — admin marca/desmarca como ocupado
router.patch('/slots/:id/ocupado', async (req: Request, res: Response) => {
  const { admin_email, ocupado } = req.body;
  const novoStatus = ocupado ? 'ocupado' : 'ativo';
  const result = await pool.query(
    `UPDATE agenda_slots SET status=$1 WHERE id=$2 AND admin_email=$3 RETURNING *`,
    [novoStatus, req.params.id, admin_email]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Slot não encontrado.' });
  res.json(result.rows[0]);
});

// DELETE /agenda/slots/:id — admin cancela slot
router.delete('/slots/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_slots SET status='cancelado' WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

export { router as agendaRouter };
