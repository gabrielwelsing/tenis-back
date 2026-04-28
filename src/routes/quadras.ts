// =============================================================================
// QUADRAS ROUTER — Locais, quadras, disponibilidade, reservas e bloqueios
// Isolamento multi-tenant: admin vê apenas seus locais
// Agendamentos: qualquer usuário pode ver e reservar (público)
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// ===========================================================================
// LOCAIS
// ===========================================================================

// GET /quadras/locais?admin_email= — admin lista seus locais
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

// GET /quadras/locais/publico?admin_email= — alunos veem locais do admin (sem dados de gestão)
router.get('/locais/publico', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const result = await pool.query(
    `SELECT l.id, l.nome, l.endereco, l.socios_only, l.observacao,
            COALESCE(
              json_agg(
                json_build_object('id',q.id,'nome',q.nome,'preco_hora',q.preco_hora)
              ) FILTER (WHERE q.id IS NOT NULL), '[]'
            ) AS quadras
     FROM locais l
     LEFT JOIN quadras q ON q.local_id = l.id AND q.ativa = true
     WHERE l.admin_email = $1 AND l.ativo = true
     GROUP BY l.id ORDER BY l.created_at`,
    [admin_email]
  );
  res.json(result.rows);
});

// POST /quadras/locais — admin cria local
router.post('/locais', async (req: Request, res: Response) => {
  const { admin_email, nome, endereco, observacao, socios_only } = req.body;
  if (!admin_email || !nome)
    return res.status(400).json({ error: 'admin_email e nome obrigatórios.' });

  const result = await pool.query(
    `INSERT INTO locais (admin_email, nome, endereco, observacao, socios_only)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [admin_email, nome, endereco ?? null, observacao ?? null, socios_only ?? false]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /quadras/locais/:id — admin edita local
router.put('/locais/:id', async (req: Request, res: Response) => {
  const { admin_email, nome, endereco, observacao, socios_only } = req.body;
  const result = await pool.query(
    `UPDATE locais SET nome=$1, endereco=$2, observacao=$3, socios_only=$4
     WHERE id=$5 AND admin_email=$6 RETURNING *`,
    [nome, endereco ?? null, observacao ?? null, socios_only ?? false, req.params.id, admin_email]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Local não encontrado.' });
  res.json(result.rows[0]);
});

// DELETE /quadras/locais/:id — admin remove local
router.delete('/locais/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE locais SET ativo=false WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

// ===========================================================================
// QUADRAS (dentro de um local)
// ===========================================================================

// POST /quadras — admin adiciona quadra ao local
router.post('/', async (req: Request, res: Response) => {
  const { local_id, nome, preco_hora } = req.body;
  if (!local_id || !nome)
    return res.status(400).json({ error: 'local_id e nome obrigatórios.' });

  const result = await pool.query(
    `INSERT INTO quadras (local_id, nome, preco_hora) VALUES ($1,$2,$3) RETURNING *`,
    [local_id, nome, preco_hora ?? 0]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /quadras/:id — admin edita quadra
router.put('/:id', async (req: Request, res: Response) => {
  const { nome, preco_hora } = req.body;
  const result = await pool.query(
    `UPDATE quadras SET nome=$1, preco_hora=$2 WHERE id=$3 RETURNING *`,
    [nome, preco_hora ?? 0, req.params.id]
  );
  res.json(result.rows[0]);
});

// DELETE /quadras/:id — admin desativa quadra
router.delete('/:id', async (req: Request, res: Response) => {
  await pool.query(`UPDATE quadras SET ativa=false WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ===========================================================================
// DISPONIBILIDADE
// ===========================================================================

// POST /quadras/disponibilidade — admin define horários padrão
router.post('/disponibilidade', async (req: Request, res: Response) => {
  const { quadra_id, dias_semana, hora_inicio, hora_fim } = req.body;
  if (!quadra_id || !dias_semana || hora_inicio === undefined || hora_fim === undefined)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  // Substitui disponibilidade existente
  await pool.query(`DELETE FROM quadra_disponibilidade WHERE quadra_id=$1`, [quadra_id]);
  const result = await pool.query(
    `INSERT INTO quadra_disponibilidade (quadra_id, dias_semana, hora_inicio, hora_fim)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [quadra_id, dias_semana, hora_inicio, hora_fim]
  );
  res.status(201).json(result.rows[0]);
});

// GET /quadras/:id/disponibilidade?data=YYYY-MM-DD — slots de uma quadra numa data
router.get('/:id/disponibilidade', async (req: Request, res: Response) => {
  const { data } = req.query as Record<string, string>;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });

  const dow = new Date(data + 'T12:00:00').getDay();

  // Busca configuração de disponibilidade
  const disp = await pool.query(
    `SELECT * FROM quadra_disponibilidade WHERE quadra_id=$1 AND $2 = ANY(dias_semana)`,
    [req.params.id, dow]
  );

  if (!disp.rows.length) return res.json({ disponivel: false, motivo: 'Quadra não disponível neste dia.', slots: [] });

  const { hora_inicio, hora_fim } = disp.rows[0];

  // Busca reservas e bloqueios para a data
  const [reservas, bloqueios] = await Promise.all([
    pool.query(`SELECT hora, status FROM quadra_reservas WHERE quadra_id=$1 AND data=$2 AND status != 'cancelada'`, [req.params.id, data]),
    pool.query(`SELECT hora_inicio, hora_fim FROM quadra_bloqueios WHERE quadra_id=$1 AND data=$2`, [req.params.id, data]),
  ]);

  const reservaMap: Record<number, string> = {};
  reservas.rows.forEach(r => { reservaMap[r.hora] = r.status; });

  const bloqueadoSet = new Set<number>();
  bloqueios.rows.forEach(b => {
    for (let h = b.hora_inicio; h < b.hora_fim; h++) bloqueadoSet.add(h);
  });

  const quadraInfo = await pool.query(`SELECT nome, preco_hora FROM quadras WHERE id=$1`, [req.params.id]);
  const { preco_hora } = quadraInfo.rows[0] || { preco_hora: 0 };

  const slots = [];
  for (let h = hora_inicio; h < hora_fim; h++) {
    const status = bloqueadoSet.has(h) ? 'bloqueado' : (reservaMap[h] || 'livre');
    slots.push({ hora: h, status, preco: Number(preco_hora) });
  }

  res.json({ disponivel: true, slots });
});

// ===========================================================================
// RESERVAS
// ===========================================================================

// POST /quadras/reservas — reservar ou entrar na lista de espera
router.post('/reservas', async (req: Request, res: Response) => {
  const { quadra_id, email_aluno, nome_reserva, whatsapp, data, hora, lista_espera } = req.body;
  if (!quadra_id || !nome_reserva || !data || hora === undefined)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const status = lista_espera ? 'lista_espera' : 'ativa';

  try {
    const result = await pool.query(
      `INSERT INTO quadra_reservas (quadra_id, email_aluno, nome_reserva, whatsapp, data, hora, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [quadra_id, email_aluno ?? null, nome_reserva, whatsapp ?? null, data, hora, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Horário já reservado.' });
    throw e;
  }
});

// DELETE /quadras/reservas/:id — cancelar reserva
router.delete('/reservas/:id', async (req: Request, res: Response) => {
  await pool.query(`UPDATE quadra_reservas SET status='cancelada' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// GET /quadras/:id/reservas?data= — admin vê reservas da quadra
router.get('/:id/reservas', async (req: Request, res: Response) => {
  const { data } = req.query as Record<string, string>;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  const result = await pool.query(
    `SELECT * FROM quadra_reservas WHERE quadra_id=$1 AND data=$2 AND status != 'cancelada' ORDER BY hora`,
    [req.params.id, data]
  );
  res.json(result.rows);
});

// ===========================================================================
// BLOQUEIOS
// ===========================================================================

// POST /quadras/bloqueios — admin bloqueia horários
router.post('/bloqueios', async (req: Request, res: Response) => {
  const { quadra_id, data, hora_inicio, hora_fim, motivo } = req.body;
  if (!quadra_id || !data || hora_inicio === undefined || hora_fim === undefined)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const result = await pool.query(
    `INSERT INTO quadra_bloqueios (quadra_id, data, hora_inicio, hora_fim, motivo)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [quadra_id, data, hora_inicio, hora_fim, motivo ?? null]
  );
  res.status(201).json(result.rows[0]);
});

// GET /quadras/:id/bloqueios?data= — lista bloqueios de uma quadra
router.get('/:id/bloqueios', async (req: Request, res: Response) => {
  const { data } = req.query as Record<string, string>;
  const where = data ? `AND data=$2` : '';
  const params = data ? [req.params.id, data] : [req.params.id];
  const result = await pool.query(
    `SELECT * FROM quadra_bloqueios WHERE quadra_id=$1 ${where} ORDER BY data, hora_inicio`,
    params
  );
  res.json(result.rows);
});

// DELETE /quadras/bloqueios/:id — remove bloqueio
router.delete('/bloqueios/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM quadra_bloqueios WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

export { router as quadrasRouter };
