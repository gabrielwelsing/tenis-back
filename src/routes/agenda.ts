import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Helper: monta slots do dia (fixos + overrides + manuais) ────────────────
async function buildSlotsDodia(admin_email: string, data: string, isAdmin: boolean) {
  const dow    = new Date(data + 'T12:00:00').getDay();
  const agora  = new Date();
  const isHoje = data === agora.toISOString().split('T')[0];

  // 1. Horários fixos ativos para o dia da semana
  const fixos = await pool.query(
    `SELECT * FROM agenda_horarios_fixos
     WHERE admin_email=$1 AND dia_semana=$2 AND ativo=true
     ORDER BY hora_inicio`,
    [admin_email, dow]
  );

  // 2. Overrides para a data específica
  const overrides = await pool.query(
    `SELECT * FROM agenda_slot_override WHERE admin_email=$1 AND data=$2`,
    [admin_email, data]
  );
  const overrideMap: Record<string, any> = {};
  overrides.rows.forEach(o => { overrideMap[String(o.hora_inicio)] = o; });

  // 3. Slots manuais para a data
  const manuais = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email=$1 AND data=$2 AND status != 'cancelado'
     ORDER BY hora_inicio`,
    [admin_email, data]
  );

  // 4. Inscrições para a data
  const inscricoes = await pool.query(
    `SELECT i.*, u.foto_url
     FROM agenda_inscricoes i
     LEFT JOIN users u ON LOWER(u.email) = LOWER(i.email_aluno)
     WHERE i.admin_email=$1 AND i.data=$2 AND i.status != 'cancelada'
     ORDER BY i.created_at`,
    [admin_email, data]
  );
  const inscMap: Record<string, any[]> = {};
  inscricoes.rows.forEach(i => {
    const key = String(i.hora_inicio);
    if (!inscMap[key]) inscMap[key] = [];
    inscMap[key].push(i);
  });

  const slots: any[] = [];
  const horasUsadas  = new Set<string>();

  // Processar slots fixos
  for (const fixo of fixos.rows) {
    const hi       = String(fixo.hora_inicio);
    const override = overrideMap[hi];

    if (override?.status === 'cancelado') continue;

    const tipo         = override?.tipo  ?? 'individual';
    const vagas        = override?.vagas ?? 1;
    const inscs        = inscMap[hi] ?? [];
    const confirmadas  = inscs.filter(i => i.status === 'confirmada').length;

    let perto1h = false;
    if (isHoje) {
      const [hh, mm] = hi.split(':').map(Number);
      const slotTime = new Date(data + 'T' + hi);
      const diffMs   = slotTime.getTime() - agora.getTime();
      perto1h = diffMs > 0 && diffMs <= 3_600_000;
    }

    const slot: any = {
      source:           'fixo',
      fixo_id:          fixo.id,
      override_id:      override?.id ?? null,
      hora_inicio:      hi,
      hora_fim:         String(fixo.hora_fim),
      tipo,
      vagas,
      vagas_confirmadas: confirmadas,
      perto1h,
    };

    if (isAdmin) slot.inscricoes = inscs;

    slots.push(slot);
    horasUsadas.add(hi);
  }

  // Processar slots manuais que não conflitem com fixos
  for (const manual of manuais.rows) {
    const hi = String(manual.hora_inicio);
    if (horasUsadas.has(hi)) continue;

    const inscs       = inscMap[hi] ?? [];
    const confirmadas = inscs.filter(i => i.status === 'confirmada').length;

    let perto1h = false;
    if (isHoje) {
      const slotTime = new Date(data + 'T' + hi);
      const diffMs   = slotTime.getTime() - agora.getTime();
      perto1h = diffMs > 0 && diffMs <= 3_600_000;
    }

    const slot: any = {
      source:            'manual',
      slot_id:           manual.id,
      hora_inicio:       hi,
      hora_fim:          String(manual.hora_fim),
      tipo:              manual.tipo,
      vagas:             manual.vagas,
      vagas_confirmadas: confirmadas,
      status_manual:     manual.status,
      observacao:        manual.observacao ?? null,
      perto1h,
    };

    if (isAdmin) slot.inscricoes = inscs;

    slots.push(slot);
  }

  slots.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  return slots;
}

// ===========================================================================
// ROTAS EXISTENTES (mantidas)
// ===========================================================================

// GET /agenda/admin-info
router.get('/admin-info', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT email, telefone FROM users WHERE role = 'admin' LIMIT 1`
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Admin não encontrado.' });
  res.json(result.rows[0]);
});

// GET /agenda/slots — visão aluno (legado)
router.get('/slots', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const hoje = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email=$1 AND data=$2 AND status='ativo' AND tipo != 'bloqueado'
     ORDER BY hora_inicio`,
    [admin_email, data || hoje]
  );
  res.json(result.rows);
});

// GET /agenda/slots/admin — visão admin (legado)
router.get('/slots/admin', async (req: Request, res: Response) => {
  const { admin_email, data } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const hoje = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email=$1 AND data=$2 AND status != 'cancelado'
     ORDER BY hora_inicio`,
    [admin_email, data || hoje]
  );
  res.json(result.rows);
});

// POST /agenda/slots — admin cria slot manual
router.post('/slots', async (req: Request, res: Response) => {
  const { admin_email, data, hora_inicio, hora_fim, tipo, vagas, observacao } = req.body;
  if (!admin_email || !data || !hora_inicio || !hora_fim || !tipo)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  const exists = await pool.query(
    `SELECT id FROM agenda_slots
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status != 'cancelado'`,
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

// PATCH /agenda/slots/:id/ocupado
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

// DELETE /agenda/slots/:id
router.delete('/slots/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_slots SET status='cancelado' WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

// ===========================================================================
// NOVAS ROTAS
// ===========================================================================

// GET /agenda/dia?admin_email=&data=&role= — todos os slots do dia
router.get('/dia', async (req: Request, res: Response) => {
  const { admin_email, data, role } = req.query as Record<string, string>;
  if (!admin_email || !data)
    return res.status(400).json({ error: 'admin_email e data obrigatórios.' });
  try {
    const slots = await buildSlotsDodia(admin_email, data, role === 'admin');
    res.json(slots);
  } catch (e) {
    console.error('[agenda/dia]', e);
    res.status(500).json({ error: 'Erro ao buscar slots.' });
  }
});

// GET /agenda/horarios-fixos?admin_email= — lista template
router.get('/horarios-fixos', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const result = await pool.query(
    `SELECT * FROM agenda_horarios_fixos
     WHERE admin_email=$1 ORDER BY dia_semana, hora_inicio`,
    [admin_email]
  );
  res.json(result.rows);
});

// POST /agenda/horarios-fixos — admin cria horário fixo
router.post('/horarios-fixos', async (req: Request, res: Response) => {
  const { admin_email, dia_semana, hora_inicio, hora_fim } = req.body;
  if (!admin_email || dia_semana === undefined || !hora_inicio || !hora_fim)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  try {
    const result = await pool.query(
      `INSERT INTO agenda_horarios_fixos (admin_email, dia_semana, hora_inicio, hora_fim)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [admin_email, dia_semana, hora_inicio, hora_fim]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Horário fixo já existe.' });
    throw e;
  }
});

// DELETE /agenda/horarios-fixos/:id — admin desativa horário fixo
router.delete('/horarios-fixos/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_horarios_fixos SET ativo=false WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

// POST /agenda/slot-override — admin configura slot específico de uma data (upsert)
router.post('/slot-override', async (req: Request, res: Response) => {
  const { admin_email, data, hora_inicio, hora_fim, tipo, vagas, status } = req.body;
  if (!admin_email || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  const result = await pool.query(
    `INSERT INTO agenda_slot_override (admin_email, data, hora_inicio, hora_fim, tipo, vagas, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (admin_email, data, hora_inicio)
     DO UPDATE SET tipo=$5, vagas=$6, status=$7
     RETURNING *`,
    [admin_email, data, hora_inicio, hora_fim, tipo ?? 'individual', vagas ?? 1, status ?? 'ativo']
  );
  res.json(result.rows[0]);
});

// GET /agenda/solicitacoes?admin_email= — admin vê solicitações
router.get('/solicitacoes', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });
  const result = await pool.query(
    `SELECT i.*, u.foto_url
     FROM agenda_inscricoes i
     LEFT JOIN users u ON LOWER(u.email) = LOWER(i.email_aluno)
     WHERE i.admin_email=$1
       AND i.data >= CURRENT_DATE
       AND i.status IN ('pendente','lista_espera','confirmada')
     ORDER BY i.data, i.hora_inicio, i.created_at`,
    [admin_email]
  );
  res.json(result.rows);
});

// POST /agenda/reservas — usuário solicita reserva
router.post('/reservas', async (req: Request, res: Response) => {
  const { admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario } = req.body;
  if (!admin_email || !data || !hora_inicio || !hora_fim || !email_aluno || !nome_aluno)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  // Verifica se já tem solicitação ativa do mesmo usuário nesse slot
  const jaReservou = await pool.query(
    `SELECT id FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND email_aluno=$4
       AND status NOT IN ('cancelada')`,
    [admin_email, data, hora_inicio, email_aluno]
  );
  if (jaReservou.rows.length > 0)
    return res.status(409).json({ error: 'Você já tem uma solicitação neste horário.' });

  // Busca configuração do slot
  const override = await pool.query(
    `SELECT * FROM agenda_slot_override
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
    [admin_email, data, hora_inicio]
  );
  const tipo  = override.rows[0]?.tipo  ?? 'individual';
  const vagas = override.rows[0]?.vagas ?? 1;

  // Conta confirmadas
  const confResult = await pool.query(
    `SELECT COUNT(*) FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='confirmada'`,
    [admin_email, data, hora_inicio]
  );
  const qtdConfirmadas = Number(confResult.rows[0].count);

  // Define status inicial
  let status = 'pendente';
  if (tipo === 'individual' && qtdConfirmadas >= 1) status = 'lista_espera';
  if (tipo === 'coletivo'   && qtdConfirmadas >= vagas) status = 'lista_espera';

  const result = await pool.query(
    `INSERT INTO agenda_inscricoes
     (admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario ?? null, status]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /agenda/reservas/:id/confirmar — admin confirma inscrição
router.patch('/reservas/:id/confirmar', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  const { id }          = req.params;

  const inscResult = await pool.query(
    `SELECT * FROM agenda_inscricoes WHERE id=$1 AND admin_email=$2`,
    [id, admin_email]
  );
  if (!inscResult.rows.length)
    return res.status(404).json({ error: 'Inscrição não encontrada.' });
  const insc = inscResult.rows[0];

  // Configuração do slot
  const override = await pool.query(
    `SELECT * FROM agenda_slot_override
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
    [admin_email, insc.data, insc.hora_inicio]
  );
  const tipo  = override.rows[0]?.tipo  ?? 'individual';
  const vagas = override.rows[0]?.vagas ?? 1;

  // Conta confirmadas (excluindo a atual)
  const confResult = await pool.query(
    `SELECT COUNT(*) FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='confirmada' AND id!=$4`,
    [admin_email, insc.data, insc.hora_inicio, id]
  );
  const qtdConfirmadas = Number(confResult.rows[0].count);

  if (tipo === 'individual' && qtdConfirmadas >= 1)
    return res.status(409).json({ error: 'Horário individual já está confirmado.' });
  if (tipo === 'coletivo' && qtdConfirmadas >= vagas)
    return res.status(409).json({ error: 'Todas as vagas já estão preenchidas.' });

  // Confirma
  await pool.query(
    `UPDATE agenda_inscricoes SET status='confirmada', confirmado_admin=true WHERE id=$1`,
    [id]
  );

  // Se vagas cheias agora: manda pendentes para lista_espera
  const novoTotal = qtdConfirmadas + 1;
  if (tipo === 'individual' || (tipo === 'coletivo' && novoTotal >= vagas)) {
    await pool.query(
      `UPDATE agenda_inscricoes SET status='lista_espera'
       WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='pendente' AND id!=$4`,
      [admin_email, insc.data, insc.hora_inicio, id]
    );
  }

  res.json({ ok: true });
});

// PATCH /agenda/reservas/:id/cancelar — admin cancela confirmação ou inscrição
router.patch('/reservas/:id/cancelar', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  const { id }          = req.params;

  const inscResult = await pool.query(
    `SELECT * FROM agenda_inscricoes WHERE id=$1 AND admin_email=$2`,
    [id, admin_email]
  );
  if (!inscResult.rows.length)
    return res.status(404).json({ error: 'Inscrição não encontrada.' });
  const insc = inscResult.rows[0];

  // Cancela
  await pool.query(
    `UPDATE agenda_inscricoes SET status='cancelada', confirmado_admin=false WHERE id=$1`,
    [id]
  );

  // Busca próximo da lista de espera
  const proximo = await pool.query(
    `SELECT * FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='lista_espera'
     ORDER BY created_at LIMIT 1`,
    [admin_email, insc.data, insc.hora_inicio]
  );

  res.json({ ok: true, proximo_espera: proximo.rows[0] ?? null });
});

// GET /agenda/minhas-inscricoes?email_aluno=&admin_email=
router.get('/minhas-inscricoes', async (req: Request, res: Response) => {
  const { email_aluno, admin_email } = req.query as Record<string, string>;
  if (!email_aluno || !admin_email)
    return res.status(400).json({ error: 'email_aluno e admin_email obrigatórios.' });

  const result = await pool.query(
    `SELECT * FROM agenda_inscricoes
     WHERE email_aluno = $1
       AND admin_email = $2
       AND status NOT IN ('cancelada')
       AND (
         data > CURRENT_DATE
         OR (data = CURRENT_DATE AND hora_fim > NOW()::TIME)
       )
     ORDER BY data, hora_inicio`,
    [email_aluno, admin_email]
  );
  res.json(result.rows);
});

export { router as agendaRouter };
