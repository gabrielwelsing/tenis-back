// =============================================================================
// JOGOS ROUTER — Mural de Treinos
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

function normalizarJogo(row: any) {
  return {
    ...row,
    publicadoEm: Number(row.publicadoEm),
    interessados: Number(row.interessados ?? 0),
  };
}

// ---------------------------------------------------------------------------
// GET /jogos?cidade=xxx — retorna jogos ativos e futuros
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const cidade = (req.query.cidade as string | undefined)?.trim();
  const agora  = new Date();
  const hoje   = agora.toISOString().split('T')[0];
  const horaAtual = agora.toTimeString().slice(0, 5); // HH:MM

  try {
    const result = await pool.query(
      `SELECT
          j.*,
          COALESCE(j.interessados, 0) AS interessados,
          j.status,
          j.confirmado_com,
          COALESCE(u.nome, split_part(j."emailPublicador", '@', 1), 'Jogador') AS "nomePublicador",
          u.foto_url AS "fotoPublicador"
       FROM jogos j
       LEFT JOIN users u
         ON LOWER(u.email) = LOWER(j."emailPublicador")
       WHERE ($1::text IS NULL OR LOWER(j.cidade) = LOWER($1))
         AND j.status != 'encerrada'
         AND (
           (j."dataFim" IS NOT NULL AND j."dataFim" > $2)
           OR
           (j."dataFim" IS NULL AND j."dataInicio" > $2)
           OR
           (
             (j."dataFim" = $2 OR (j."dataFim" IS NULL AND j."dataInicio" = $2))
             AND j."horarioFim" > $3
           )
         )
       ORDER BY j."publicadoEm" DESC`,
      [cidade || null, hoje, horaAtual]
    );

    res.json(result.rows.map(normalizarJogo));
  } catch (e) {
    console.error('[GET /jogos]', e);
    res.status(500).json({ error: 'Erro ao carregar mural.' });
  }
});

// ---------------------------------------------------------------------------
// GET /jogos/proxima?email=xxx — próxima partida confirmada do usuário
// IMPORTANTE: esta rota precisa ficar ANTES de /:id/interessados
// ---------------------------------------------------------------------------
router.get('/proxima', async (req: Request, res: Response) => {
  const email = (req.query.email as string | undefined)?.trim();

  if (!email) {
    return res.status(400).json({ error: 'Email obrigatório.' });
  }

  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0];
  const horaAtual = agora.toTimeString().slice(0, 5); // HH:MM

  try {
    const result = await pool.query(
      `SELECT
          j.*,
          COALESCE(j.interessados, 0) AS interessados,

          CASE
            WHEN LOWER(j."emailPublicador") = LOWER($1)
              THEN COALESCE(u_confirmado.nome, split_part(j.confirmado_com, '@', 1), 'Adversário')
            ELSE
              COALESCE(u_publicador.nome, split_part(j."emailPublicador", '@', 1), 'Adversário')
          END AS "adversarioNome",

          CASE
            WHEN LOWER(j."emailPublicador") = LOWER($1)
              THEN j.confirmado_com
            ELSE
              j."emailPublicador"
          END AS "adversarioEmail"

       FROM jogos j

       LEFT JOIN users u_publicador
         ON LOWER(u_publicador.email) = LOWER(j."emailPublicador")

       LEFT JOIN users u_confirmado
         ON LOWER(u_confirmado.email) = LOWER(j.confirmado_com)

       WHERE j.status = 'confirmada'
         AND (
           LOWER(j."emailPublicador") = LOWER($1)
           OR LOWER(j.confirmado_com) = LOWER($1)
         )
         AND (
           (j."dataFim" IS NOT NULL AND j."dataFim" > $2)
           OR
           (j."dataFim" IS NULL AND j."dataInicio" > $2)
           OR
           (
             (j."dataFim" = $2 OR (j."dataFim" IS NULL AND j."dataInicio" = $2))
             AND j."horarioFim" > $3
           )
         )

       ORDER BY j."dataInicio" ASC, j."horarioInicio" ASC
       LIMIT 1`,
      [email, hoje, horaAtual]
    );

    if (!result.rows.length) {
      return res.json(null);
    }

    res.json(normalizarJogo(result.rows[0]));
  } catch (e) {
    console.error('[GET /jogos/proxima]', e);
    res.status(500).json({ error: 'Erro ao carregar próxima partida.' });
  }
});

// ---------------------------------------------------------------------------
// POST /jogos — publica disponibilidade
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const {
    id,
    cidade,
    classe,
    dataInicio,
    dataFim,
    horarioInicio,
    horarioFim,
    local,
    whatsapp,
    publicadoEm,
    emailPublicador,
  } = req.body;

  if (
    !id ||
    !cidade ||
    !classe ||
    !dataInicio ||
    !horarioInicio ||
    !horarioFim ||
    !local ||
    !whatsapp ||
    !publicadoEm
  ) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  }

  try {
    await pool.query(
      `INSERT INTO jogos (
          id,
          cidade,
          classe,
          "dataInicio",
          "dataFim",
          "horarioInicio",
          "horarioFim",
          local,
          whatsapp,
          "publicadoEm",
          "emailPublicador",
          status,
          interessados
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'aberta',0)`,
      [
        id,
        cidade,
        classe,
        dataInicio,
        dataFim ?? null,
        horarioInicio,
        horarioFim,
        local,
        whatsapp,
        BigInt(publicadoEm),
        emailPublicador ?? null,
      ]
    );

    const result = await pool.query(
      `SELECT
          j.*,
          COALESCE(j.interessados, 0) AS interessados,
          j.status,
          j.confirmado_com,
          COALESCE(u.nome, split_part(j."emailPublicador", '@', 1), 'Jogador') AS "nomePublicador",
          u.foto_url AS "fotoPublicador"
       FROM jogos j
       LEFT JOIN users u
         ON LOWER(u.email) = LOWER(j."emailPublicador")
       WHERE j.id = $1`,
      [id]
    );

    res.status(201).json(normalizarJogo(result.rows[0]));
  } catch (e) {
    console.error('[POST /jogos]', e);
    res.status(500).json({ error: 'Erro ao publicar.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /jogos/:id/datas — dono edita somente datas/horários se não confirmada
// ---------------------------------------------------------------------------
router.patch('/:id/datas', async (req: Request, res: Response) => {
  const {
    emailPublicador,
    dataInicio,
    dataFim,
    horarioInicio,
    horarioFim,
  } = req.body;

  if (!emailPublicador) {
    return res.status(400).json({ error: 'emailPublicador obrigatório.' });
  }

  if (!dataInicio || !horarioInicio || !horarioFim) {
    return res.status(400).json({ error: 'Data inicial, horário inicial e horário final são obrigatórios.' });
  }

  if (dataFim && dataFim < dataInicio) {
    return res.status(400).json({ error: 'Data final deve ser maior ou igual à data inicial.' });
  }

  if (horarioFim <= horarioInicio) {
    return res.status(400).json({ error: 'Horário final deve ser após o horário inicial.' });
  }

  try {
    const jogo = await pool.query(
      `SELECT id, status, "emailPublicador"
       FROM jogos
       WHERE id = $1`,
      [req.params.id]
    );

    if (!jogo.rows.length) {
      return res.status(404).json({ error: 'Publicação não encontrada.' });
    }

    const row = jogo.rows[0];

    if (!row.emailPublicador || row.emailPublicador.toLowerCase() !== String(emailPublicador).toLowerCase()) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    if (row.status === 'confirmada') {
      return res.status(409).json({ error: 'Partida confirmada não pode ser editada.' });
    }

    await pool.query(
      `UPDATE jogos
       SET "dataInicio" = $1,
           "dataFim" = $2,
           "horarioInicio" = $3,
           "horarioFim" = $4
       WHERE id = $5`,
      [
        dataInicio,
        dataFim ?? null,
        horarioInicio,
        horarioFim,
        req.params.id,
      ]
    );

    const atualizado = await pool.query(
      `SELECT
          j.*,
          COALESCE(j.interessados, 0) AS interessados,
          j.status,
          j.confirmado_com,
          COALESCE(u.nome, split_part(j."emailPublicador", '@', 1), 'Jogador') AS "nomePublicador",
          u.foto_url AS "fotoPublicador"
       FROM jogos j
       LEFT JOIN users u
         ON LOWER(u.email) = LOWER(j."emailPublicador")
       WHERE j.id = $1`,
      [req.params.id]
    );

    res.json(normalizarJogo(atualizado.rows[0]));
  } catch (e) {
    console.error('[PATCH /jogos/:id/datas]', e);
    res.status(500).json({ error: 'Erro ao editar publicação.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /jogos/:id — remove publicação se não confirmada
// ---------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  const { emailPublicador } = req.body;

  if (!emailPublicador) {
    return res.status(400).json({ error: 'emailPublicador obrigatório.' });
  }

  try {
    const jogo = await pool.query(
      `SELECT id, status, "emailPublicador"
       FROM jogos
       WHERE id = $1`,
      [req.params.id]
    );

    if (!jogo.rows.length) {
      return res.status(404).json({ error: 'Publicação não encontrada.' });
    }

    const row = jogo.rows[0];

    if (!row.emailPublicador || row.emailPublicador.toLowerCase() !== String(emailPublicador).toLowerCase()) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    if (row.status === 'confirmada') {
      return res.status(409).json({ error: 'Partida confirmada não pode ser excluída.' });
    }

    await pool.query(
      `DELETE FROM jogos WHERE id = $1`,
      [req.params.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /jogos/:id]', e);
    res.status(500).json({ error: 'Erro ao remover publicação.' });
  }
});

// ---------------------------------------------------------------------------
// POST /jogos/:id/interessado — usuário clicou em WhatsApp
// ---------------------------------------------------------------------------
router.post('/:id/interessado', async (req: Request, res: Response) => {
  const { email_usuario, nome_usuario } = req.body;

  if (!email_usuario || !nome_usuario) {
    return res.status(400).json({ error: 'email_usuario e nome_usuario obrigatórios.' });
  }

  try {
    await pool.query(
      `INSERT INTO jogo_interessados (jogo_id, email_usuario, nome_usuario)
       VALUES ($1,$2,$3)
       ON CONFLICT (jogo_id, email_usuario) DO NOTHING`,
      [req.params.id, email_usuario, nome_usuario]
    );

    await pool.query(
      `UPDATE jogos SET interessados = (
         SELECT COUNT(*) FROM jogo_interessados WHERE jogo_id=$1
       ) WHERE id=$1`,
      [req.params.id]
    );

    const jogo = await pool.query(
      `SELECT interessados FROM jogos WHERE id=$1`,
      [req.params.id]
    );

    res.json({ interessados: jogo.rows[0]?.interessados ?? 0 });
  } catch (e) {
    console.error('[POST /jogos/:id/interessado]', e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ---------------------------------------------------------------------------
// GET /jogos/:id/interessados — lista interessados, somente para dono da sala
// ---------------------------------------------------------------------------
router.get('/:id/interessados', async (req: Request, res: Response) => {
  const { email_publicador } = req.query as Record<string, string>;

  try {
    const jogo = await pool.query(
      `SELECT "emailPublicador" FROM jogos WHERE id=$1`,
      [req.params.id]
    );

    if (!jogo.rows.length) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    if (jogo.rows[0].emailPublicador !== email_publicador) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    const result = await pool.query(
      `SELECT email_usuario, nome_usuario, created_at
       FROM jogo_interessados
       WHERE jogo_id=$1
       ORDER BY created_at`,
      [req.params.id]
    );

    res.json(result.rows);
  } catch (e) {
    console.error('[GET /jogos/:id/interessados]', e);
    res.status(500).json({ error: 'Erro ao listar interessados.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /jogos/:id/confirmar — dono confirma com interessado
// ---------------------------------------------------------------------------
router.patch('/:id/confirmar', async (req: Request, res: Response) => {
  const { email_publicador, confirmado_com } = req.body;

  if (!email_publicador || !confirmado_com) {
    return res.status(400).json({ error: 'email_publicador e confirmado_com obrigatórios.' });
  }

  try {
    const jogo = await pool.query(
      `SELECT "emailPublicador" FROM jogos WHERE id=$1`,
      [req.params.id]
    );

    if (!jogo.rows.length) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    if (jogo.rows[0].emailPublicador !== email_publicador) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    await pool.query(
      `UPDATE jogos
       SET status='confirmada',
           confirmado_com=$1
       WHERE id=$2`,
      [confirmado_com, req.params.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /jogos/:id/confirmar]', e);
    res.status(500).json({ error: 'Erro ao confirmar partida.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /jogos/:id/encerrar — dono encerra a sala manualmente
// ---------------------------------------------------------------------------
router.patch('/:id/encerrar', async (req: Request, res: Response) => {
  const { email_publicador } = req.body;

  if (!email_publicador) {
    return res.status(400).json({ error: 'email_publicador obrigatório.' });
  }

  try {
    const jogo = await pool.query(
      `SELECT "emailPublicador" FROM jogos WHERE id=$1`,
      [req.params.id]
    );

    if (!jogo.rows.length) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    if (jogo.rows[0].emailPublicador !== email_publicador) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    await pool.query(
      `UPDATE jogos SET status='encerrada' WHERE id=$1`,
      [req.params.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /jogos/:id/encerrar]', e);
    res.status(500).json({ error: 'Erro ao encerrar partida.' });
  }
});

export { router as jogosRouter };
