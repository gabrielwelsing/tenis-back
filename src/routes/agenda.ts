import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

async function buildSlotsDodia(admin_email: string, data: string, isAdmin: boolean) {
  const dow    = new Date(data + 'T12:00:00').getDay();
  const agora  = new Date();
  const isHoje = data === agora.toISOString().split('T')[0];

  const fixos = await pool.query(
    `SELECT * FROM agenda_horarios_fixos
     WHERE admin_email=$1 AND dia_semana=$2 AND ativo=true
     ORDER BY hora_inicio`,
    [admin_email, dow]
  );

  const overrides = await pool.query(
    `SELECT * FROM agenda_slot_override WHERE admin_email=$1 AND data=$2`,
    [admin_email, data]
  );
  const overrideMap: Record<string, any> = {};
  overrides.rows.forEach(o => { overrideMap[String(o.hora_inicio)] = o; });

  const manuais = await pool.query(
    `SELECT * FROM agenda_slots
     WHERE admin_email=$1 AND data=$2 AND status != 'cancelado'
     ORDER BY hora_inicio`,
    [admin_email, data]
  );

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

  for (const fixo of fixos.rows) {
    const hi       = String(fixo.hora_inicio);
    const override = overrideMap[hi];

    if (override?.status === 'cancelado') continue;

    const tipo  = override?.tipo  ?? 'individual';
    const vagas = override?.vagas ?? 1;

    // ── Nome fixado: verifica se a data está no período de validade ──────────
    const nomeDe  = fixo.valido_de  ? new Date(fixo.valido_de).toISOString().slice(0, 10)  : null;
    const nomeAte = fixo.valido_ate ? new Date(fixo.valido_ate).toISOString().slice(0, 10) : null;
    const nomeValido = (fixo.nome || fixo.email_vinculado) && (
      (!nomeDe  || data >= nomeDe) &&
      (!nomeAte || data <= nomeAte)
    );
    const nomeFixo = nomeValido ? (fixo.nome || fixo.email_vinculado) : null;

    const inscs       = inscMap[hi] ?? [];
    const confirmadas = inscs.filter(i => i.status === 'confirmada').length;

    // Se tem nome fixado, trata como vaga ocupada
    const vagasConfirmadas = nomeFixo ? vagas : confirmadas;

    let perto1h = false;
    if (isHoje) {
      const slotTime = new Date(data + 'T' + hi);
      const diffMs   = slotTime.getTime() - agora.getTime();
      perto1h = diffMs > 0 && diffMs <= 3_600_000;
    }

    const slot: any = {
      source:            'fixo',
      fixo_id:           fixo.id,
      override_id:       override?.id ?? null,
      hora_inicio:       hi,
      hora_fim:          String(fixo.hora_fim),
      tipo,
      vagas,
      vagas_confirmadas: vagasConfirmadas,
      perto1h,
      nome_fixo:         nomeFixo,
    };

    if (isAdmin) slot.inscricoes = inscs;

    slots.push(slot);
    horasUsadas.add(hi);
  }

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
      nome_fixo:         null,
    };

    if (isAdmin) slot.inscricoes = inscs;

    slots.push(slot);
  }

  slots.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  return slots;
}

// ===========================================================================

router.get('/admin-info', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT email, telefone FROM users WHERE role = 'admin' LIMIT 1`
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Admin não encontrado.' });
  res.json(result.rows[0]);
});

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

router.delete('/slots/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_slots SET status='cancelado' WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

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

router.post('/horarios-fixos', async (req: Request, res: Response) => {
  const { admin_email, dia_semana, hora_inicio, hora_fim } = req.body;
  if (!admin_email || dia_semana === undefined || !hora_inicio || !hora_fim)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  try {
    const result = await pool.query(
      `INSERT INTO agenda_horarios_fixos (admin_email, dia_semana, hora_inicio, hora_fim)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (admin_email, dia_semana, hora_inicio)
      DO UPDATE SET ativo=true, hora_fim=$4
      RETURNING *`,
      [admin_email, dia_semana, hora_inicio, hora_fim]
    );
 
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[POST /horarios-fixos]', e);
    res.status(500).json({ error: 'Erro ao salvar horário fixo.' });
  } 
});

// ── NOVO: PATCH /agenda/horarios-fixos/:id — salva nome/período ──────────────
router.patch('/horarios-fixos/:id', async (req: Request, res: Response) => {
  const { admin_email, nome, email_vinculado, valido_de, valido_ate } = req.body;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const result = await pool.query(
    `UPDATE agenda_horarios_fixos
     SET nome=$1, email_vinculado=$2, valido_de=$3, valido_ate=$4
     WHERE id=$5 AND admin_email=$6 RETURNING *`,
    [
      nome        || null,
      email_vinculado || null,
      valido_de   || null,
      valido_ate  || null,
      req.params.id,
      admin_email,
    ]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Horário fixo não encontrado.' });
  res.json(result.rows[0]);
});

router.delete('/horarios-fixos/:id', async (req: Request, res: Response) => {
  const { admin_email } = req.body;
  await pool.query(
    `UPDATE agenda_horarios_fixos SET ativo=false WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  res.json({ ok: true });
});

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

router.get('/solicitacoes', async (req: Request, res: Response) => {
  const { admin_email, incluir_historico } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const incluiHistorico = incluir_historico === '1' || incluir_historico === 'true';

  const query = incluiHistorico
    ? `SELECT i.*, u.foto_url
       FROM agenda_inscricoes i
       LEFT JOIN users u ON LOWER(u.email) = LOWER(i.email_aluno)
       WHERE i.admin_email=$1
         AND i.status IN ('pendente','lista_espera','confirmada')
         AND (
           i.status = 'confirmada'
           OR i.data > CURRENT_DATE
           OR (i.data = CURRENT_DATE AND i.hora_fim > NOW()::TIME)
         )
       ORDER BY i.data, i.hora_inicio, i.created_at`
    : `SELECT i.*, u.foto_url
       FROM agenda_inscricoes i
       LEFT JOIN users u ON LOWER(u.email) = LOWER(i.email_aluno)
       WHERE i.admin_email=$1
         AND i.status IN ('pendente','lista_espera','confirmada')
         AND (
           i.data > CURRENT_DATE
           OR (i.data = CURRENT_DATE AND i.hora_fim > NOW()::TIME)
         )
       ORDER BY i.data, i.hora_inicio, i.created_at`;

  const result = await pool.query(query, [admin_email]);
  res.json(result.rows);
});

router.post('/reservas', async (req: Request, res: Response) => {
  const { admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario } = req.body;
  if (!admin_email || !data || !hora_inicio || !hora_fim || !email_aluno || !nome_aluno)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const jaReservou = await pool.query(
    `SELECT id FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND email_aluno=$4
       AND status NOT IN ('cancelada')`,
    [admin_email, data, hora_inicio, email_aluno]
  );
  if (jaReservou.rows.length > 0)
    return res.status(409).json({ error: 'Você já tem uma solicitação neste horário.' });

  const override = await pool.query(
    `SELECT * FROM agenda_slot_override
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
    [admin_email, data, hora_inicio]
  );
  const tipo  = override.rows[0]?.tipo  ?? 'individual';
  const vagas = override.rows[0]?.vagas ?? 1;

  const confResult = await pool.query(
    `SELECT COUNT(*) FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='confirmada'`,
    [admin_email, data, hora_inicio]
  );
  const qtdConfirmadas = Number(confResult.rows[0].count);

  // Também verifica se tem nome fixado (conta como ocupado)
  const fixoResult = await pool.query(
    `SELECT nome, valido_de, valido_ate FROM agenda_horarios_fixos
     WHERE admin_email=$1 AND dia_semana=$2 AND hora_inicio=$3 AND ativo=true AND nome IS NOT NULL`,
    [admin_email, new Date(data + 'T12:00:00').getDay(), hora_inicio]
  );
  const fixoNome = fixoResult.rows[0];
  const nomeValido = fixoNome && (
    (!fixoNome.valido_de  || data >= String(fixoNome.valido_de).slice(0, 10)) &&
    (!fixoNome.valido_ate || data <= String(fixoNome.valido_ate).slice(0, 10))
  );
  const ocupadoPorNome = nomeValido && tipo === 'individual';

  let status = 'pendente';
  if (ocupadoPorNome) status = 'lista_espera';
  else if (tipo === 'individual' && qtdConfirmadas >= 1) status = 'lista_espera';
  else if (tipo === 'coletivo'   && qtdConfirmadas >= vagas) status = 'lista_espera';

  const result = await pool.query(
    `INSERT INTO agenda_inscricoes
     (admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [admin_email, data, hora_inicio, hora_fim, email_aluno, nome_aluno, telefone_usuario ?? null, status]
  );
  res.status(201).json(result.rows[0]);
});

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

  const override = await pool.query(
    `SELECT * FROM agenda_slot_override
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
    [admin_email, insc.data, insc.hora_inicio]
  );
  const tipo  = override.rows[0]?.tipo  ?? 'individual';
  const vagas = override.rows[0]?.vagas ?? 1;

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

  await pool.query(
    `UPDATE agenda_inscricoes SET status='confirmada', confirmado_admin=true WHERE id=$1`,
    [id]
  );

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

  await pool.query(
    `UPDATE agenda_inscricoes SET status='cancelada', confirmado_admin=false WHERE id=$1`,
    [id]
  );

  const proximo = await pool.query(
    `SELECT * FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='lista_espera'
     ORDER BY created_at LIMIT 1`,
    [admin_email, insc.data, insc.hora_inicio]
  );

  res.json({ ok: true, proximo_espera: proximo.rows[0] ?? null });
});

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

router.get('/proxima', async (req: Request, res: Response) => {
  const email = (req.query.email as string | undefined)?.trim();
  const role  = (req.query.role  as string | undefined)?.trim();
  if (!email) return res.status(400).json({ error: 'email obrigatório.' });

  const isAdmin = role === 'admin';
  try {
    const result = await pool.query(
      `SELECT i.id, i.admin_email, i.data::text AS data,
              i.hora_inicio::text AS hora_inicio, i.hora_fim::text AS hora_fim,
              i.email_aluno, i.nome_aluno, i.telefone_usuario, i.status, i.created_at,
              u_aluno.foto_url AS foto_aluno
       FROM agenda_inscricoes i
       LEFT JOIN users u_aluno ON LOWER(u_aluno.email) = LOWER(i.email_aluno)
       WHERE ${isAdmin ? 'LOWER(i.admin_email) = LOWER($1)' : 'LOWER(i.email_aluno) = LOWER($1)'}
         AND i.status = 'confirmada'
         AND (i.data > CURRENT_DATE OR (i.data = CURRENT_DATE AND i.hora_fim > NOW()::TIME))
       ORDER BY i.data ASC, i.hora_inicio ASC LIMIT 1`,
      [email]
    );
    if (!result.rows.length) return res.json(null);
    const aula = result.rows[0];
    res.json({
      tipo: 'aula', id: aula.id,
      dataInicio: aula.data, dataFim: null,
      horarioInicio: String(aula.hora_inicio).slice(0, 5),
      horarioFim:    String(aula.hora_fim).slice(0, 5),
      local: 'Agenda do Prof. Carlão', status: 'confirmada',
      alunoNome:      aula.nome_aluno,
      alunoEmail:     aula.email_aluno,
      adversarioNome: isAdmin ? aula.nome_aluno  : 'Prof. Carlão',
      adversarioEmail:isAdmin ? aula.email_aluno : aula.admin_email,
    });
  } catch (e) {
    console.error('[GET /agenda/proxima]', e);
    res.status(500).json({ error: 'Erro ao carregar próxima aula.' });
  }
});

router.get('/atividades', async (req: Request, res: Response) => {
  const email = (req.query.email as string | undefined)?.trim();
  const role  = (req.query.role  as string | undefined)?.trim();
  if (!email) return res.status(400).json({ error: 'email obrigatório.' });

  const isAdmin = role === 'admin';
  try {
    const result = await pool.query(
      `SELECT
          ('agenda-' || i.id::text) AS id,
          i.id AS "origemId",
          'aula' AS tipo,
          i.data::text AS "dataInicio",
          NULL::text AS "dataFim",
          i.hora_inicio::text AS "horarioInicio",
          i.hora_fim::text AS "horarioFim",
          'Agenda do Prof. Carlão' AS local,
          CASE WHEN $2::boolean
            THEN ('Aula com ' || COALESCE(i.nome_aluno, split_part(i.email_aluno,'@',1),'aluno'))
            ELSE 'Aula com Prof. Carlão'
          END AS titulo,
          CASE WHEN $2::boolean THEN i.email_aluno   ELSE i.admin_email  END AS "pessoaEmail",
          CASE WHEN $2::boolean
            THEN COALESCE(i.nome_aluno, split_part(i.email_aluno,'@',1),'aluno')
            ELSE 'Prof. Carlão'
          END AS "pessoaNome",
          i.status,
          CASE WHEN i.data < CURRENT_DATE
            OR (i.data = CURRENT_DATE AND i.hora_fim <= NOW()::TIME)
            THEN true ELSE false END AS passado
       FROM agenda_inscricoes i
       WHERE ${isAdmin ? 'LOWER(i.admin_email) = LOWER($1)' : 'LOWER(i.email_aluno) = LOWER($1)'}
         AND i.status = 'confirmada'
       ORDER BY
         CASE WHEN i.data < CURRENT_DATE
           OR (i.data = CURRENT_DATE AND i.hora_fim <= NOW()::TIME) THEN 1 ELSE 0 END,
         i.data ASC, i.hora_inicio ASC
       LIMIT 80`,
      [email, isAdmin]
    );

    const atividades = result.rows.map(row => ({
      ...row,
      horarioInicio: String(row.horarioInicio).slice(0, 5),
      horarioFim:    String(row.horarioFim).slice(0, 5),
      alunoNome:     row.pessoaNome ?? null,
      alunoEmail:    row.pessoaEmail ?? null,
    }));

    if (isAdmin) {
      const fixos = await pool.query(
        `WITH ocorrencias AS (
           SELECT
             f.id,
             f.admin_email,
             f.nome,
             f.email_vinculado,
             f.hora_inicio,
             f.hora_fim,
             gs::date AS data_ocorrencia
           FROM agenda_horarios_fixos f
           CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '56 days', INTERVAL '1 day') gs
           WHERE LOWER(f.admin_email) = LOWER($1)
             AND f.ativo = true
             AND (f.nome IS NOT NULL OR f.email_vinculado IS NOT NULL)
             AND EXTRACT(DOW FROM gs)::int = f.dia_semana
             AND (f.valido_de IS NULL OR gs::date >= f.valido_de::date)
             AND (f.valido_ate IS NULL OR gs::date <= f.valido_ate::date)
             AND NOT EXISTS (
               SELECT 1
               FROM agenda_slot_override ov
               WHERE LOWER(ov.admin_email) = LOWER(f.admin_email)
                 AND ov.data = gs::date
                 AND ov.hora_inicio = f.hora_inicio
                 AND ov.status = 'cancelado'
             )
         )
         SELECT
           ('agenda-fixo-' || id::text || '-' || TO_CHAR(data_ocorrencia, 'YYYY-MM-DD')) AS id,
           id AS "origemId",
           'aula' AS tipo,
           data_ocorrencia::text AS "dataInicio",
           NULL::text AS "dataFim",
           hora_inicio::text AS "horarioInicio",
           hora_fim::text AS "horarioFim",
           'Agenda do Prof. Carlão' AS local,
           ('Aula com ' || COALESCE(nome, split_part(email_vinculado,'@',1),'aluno')) AS titulo,
           email_vinculado AS "pessoaEmail",
           COALESCE(nome, split_part(email_vinculado,'@',1),'aluno') AS "pessoaNome",
           COALESCE(nome, split_part(email_vinculado,'@',1),'aluno') AS "alunoNome",
           email_vinculado AS "alunoEmail",
           'fixo' AS status,
           false AS passado
         FROM ocorrencias
         WHERE data_ocorrencia > CURRENT_DATE
            OR (data_ocorrencia = CURRENT_DATE AND hora_fim > NOW()::TIME)
         ORDER BY data_ocorrencia ASC, hora_inicio ASC
         LIMIT 80`,
        [email]
      );

      fixos.rows.forEach(row => {
        atividades.push({
          ...row,
          horarioInicio: String(row.horarioInicio).slice(0, 5),
          horarioFim:    String(row.horarioFim).slice(0, 5),
        });
      });
    }

    atividades.sort((a, b) => {
      const dataA = `${String(a.dataInicio).slice(0, 10)}T${String(a.horarioInicio || '00:00').slice(0, 5)}:00`;
      const dataB = `${String(b.dataInicio).slice(0, 10)}T${String(b.horarioInicio || '00:00').slice(0, 5)}:00`;
      const aPassado = a.passado ? 1 : 0;
      const bPassado = b.passado ? 1 : 0;
      return aPassado - bPassado || new Date(dataA).getTime() - new Date(dataB).getTime();
    });

    res.json(atividades.slice(0, 80));
  } catch (e) {
    console.error('[GET /agenda/atividades]', e);
    res.status(500).json({ error: 'Erro ao carregar atividades da agenda.' });
  }
});

// ── Helper: gera datas futuras de uma recorrência semanal ────────────────────
function proximasOcorrencias(dia_semana: number, valido_de: string | null, valido_ate: string | null): string[] {
  const hoje = new Date().toISOString().split('T')[0];
  const de   = (valido_de && valido_de > hoje) ? valido_de : hoje;
  const ate  = valido_ate || (() => {
    const d = new Date(); d.setDate(d.getDate() + 56);
    return d.toISOString().split('T')[0];
  })();
  const datas: string[] = [];
  let cur = new Date(de + 'T12:00:00');
  const fim = new Date(ate + 'T12:00:00');
  while (cur.getDay() !== dia_semana) cur.setDate(cur.getDate() + 1);
  while (cur <= fim) {
    datas.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 7);
  }
  return datas;
}

// GET /agenda/confirmadas-fixos?admin_email= — ocorrências futuras de slots fixos com nome
router.get('/confirmadas-fixos', async (req: Request, res: Response) => {
  const { admin_email } = req.query as Record<string, string>;
  if (!admin_email) return res.status(400).json({ error: 'admin_email obrigatório.' });

  const hoje = new Date().toISOString().split('T')[0];
  const fixos = await pool.query(
    `SELECT * FROM agenda_horarios_fixos
     WHERE admin_email=$1 AND nome IS NOT NULL AND ativo=true
       AND (valido_ate IS NULL OR valido_ate::date >= $2)`,
    [admin_email, hoje]
  );

  const ocorrencias: any[] = [];

  for (const fixo of fixos.rows) {
    const datas = proximasOcorrencias(
      fixo.dia_semana,
      fixo.valido_de ? String(fixo.valido_de).slice(0,10) : null,
      fixo.valido_ate ? String(fixo.valido_ate).slice(0,10) : null,
    );

    for (const data of datas) {
      // Checa se esta data foi cancelada via slot_override
      const ov = await pool.query(
        `SELECT status FROM agenda_slot_override
         WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3`,
        [admin_email, data, fixo.hora_inicio]
      );
      if (ov.rows[0]?.status === 'cancelado') continue;

      const espera = await pool.query(
        `SELECT COUNT(*) FROM agenda_inscricoes
         WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='lista_espera'`,
        [admin_email, data, fixo.hora_inicio]
      );

      ocorrencias.push({
        fixo_id:          fixo.id,
        data,
        hora_inicio:      String(fixo.hora_inicio).slice(0, 5),
        hora_fim:         String(fixo.hora_fim).slice(0, 5),
        nome:             fixo.nome,
        dia_semana:       fixo.dia_semana,
        fila_espera_count: Number(espera.rows[0].count),
      });
    }
  }

  ocorrencias.sort((a, b) => a.data !== b.data
    ? a.data.localeCompare(b.data)
    : a.hora_inicio.localeCompare(b.hora_inicio)
  );
  res.json(ocorrencias);
});

// POST /agenda/horarios-fixos/:id/cancelar-ocorrencia
router.post('/horarios-fixos/:id/cancelar-ocorrencia', async (req: Request, res: Response) => {
  const { admin_email, data, tipo } = req.body;
  // tipo: 'esta' | 'futuras'
  if (!admin_email || !data || !tipo)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  const fixoResult = await pool.query(
    `SELECT * FROM agenda_horarios_fixos WHERE id=$1 AND admin_email=$2`,
    [req.params.id, admin_email]
  );
  if (!fixoResult.rows.length) return res.status(404).json({ error: 'Não encontrado.' });
  const fixo = fixoResult.rows[0];

  if (tipo === 'esta') {
    // Cancela só esta data via slot_override
    await pool.query(
      `INSERT INTO agenda_slot_override (admin_email, data, hora_inicio, hora_fim, tipo, vagas, status)
       VALUES ($1,$2,$3,$4,'individual',1,'cancelado')
       ON CONFLICT (admin_email, data, hora_inicio) DO UPDATE SET status='cancelado'`,
      [admin_email, data, fixo.hora_inicio, fixo.hora_fim]
    );
  } else {
    // Cancela este e todos os futuros: encurta valido_ate para data - 1 dia
    const d = new Date(data + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const novoAte = d.toISOString().split('T')[0];
    await pool.query(
      `UPDATE agenda_horarios_fixos SET valido_ate=$1 WHERE id=$2`,
      [novoAte, fixo.id]
    );
    // Se novo valido_ate ficou antes do valido_de, limpa o nome inteiramente
    const de = fixo.valido_de ? String(fixo.valido_de).slice(0,10) : null;
    if (de && novoAte < de) {
      await pool.query(
        `UPDATE agenda_horarios_fixos
         SET nome=NULL, email_vinculado=NULL, valido_de=NULL, valido_ate=NULL WHERE id=$1`,
        [fixo.id]
      );
    }
  }

  // Promove primeiro da fila de espera desta data
  const proximo = await pool.query(
    `SELECT * FROM agenda_inscricoes
     WHERE admin_email=$1 AND data=$2 AND hora_inicio=$3 AND status='lista_espera'
     ORDER BY created_at LIMIT 1`,
    [admin_email, data, fixo.hora_inicio]
  );
  if (proximo.rows.length) {
    await pool.query(`UPDATE agenda_inscricoes SET status='pendente' WHERE id=$1`, [proximo.rows[0].id]);
  }

  res.json({ ok: true, promovido: proximo.rows[0] ?? null });
});

export { router as agendaRouter };
