// =============================================================================
// RANKING ROUTER — Ligas, Temporadas, Partidas, Desafios
// Auth: JWT Bearer token (mesmo padrão de authRoutes.ts)
// Runtime: raw pg.Pool (sem Prisma Client)
// =============================================================================

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const router     = Router();
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET ?? 'floquinho1@';

// ─── Auth helper ──────────────────────────────────────────────────────────────
function getAuth(req: Request): { user_id: number; role: string } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET) as { user_id: number; role: string };
  } catch {
    return null;
  }
}

// ─── Point calculator ─────────────────────────────────────────────────────────
interface SetScore { setA: number; setB: number; }

function calcularPontos(
  placar:      SetScore[],
  tipo:        string,
  wo:          boolean,
  vencedorId:  number,
  jogadorAId:  number,
  jogadorBId:  number,
): { pontosA: number; pontosB: number; bonusA: number; bonusB: number } {
  if (wo) {
    return {
      pontosA: vencedorId === jogadorAId ? 6 : 0,
      pontosB: vencedorId === jogadorBId ? 6 : 0,
      bonusA: 0, bonusB: 0,
    };
  }

  const setsA  = placar.filter(s => s.setA > s.setB).length;
  const setsB  = placar.filter(s => s.setB > s.setA).length;
  const gamesB = placar.reduce((sum, s) => sum + s.setB, 0);
  const gamesA = placar.reduce((sum, s) => sum + s.setA, 0);

  let pontosA = 0, pontosB = 0, bonusA = 0, bonusB = 0;

  if (tipo === 'pro_set') {
    if (setsA > setsB) { pontosA = 8; pontosB = 4; }
    else               { pontosB = 8; pontosA = 4; }
  } else {
    if      (setsA === 2 && setsB === 0) { pontosA = 10; pontosB = 2; }
    else if (setsA === 2 && setsB === 1) { pontosA = 8;  pontosB = 4; }
    else if (setsB === 2 && setsA === 0) { pontosB = 10; pontosA = 2; }
    else if (setsB === 2 && setsA === 1) { pontosB = 8;  pontosA = 4; }
  }

  if (gamesB <= 2 && setsA > setsB) bonusA = 3;
  if (gamesA <= 2 && setsB > setsA) bonusB = 3;

  return { pontosA, pontosB, bonusA, bonusB };
}

// ─── Determine winner from placar ─────────────────────────────────────────────
function determinarVencedor(placar: SetScore[], jogadorAId: number, jogadorBId: number): number {
  const setsA = placar.filter(s => s.setA > s.setB).length;
  const setsB = placar.filter(s => s.setB > s.setA).length;
  return setsA > setsB ? jogadorAId : jogadorBId;
}

// ─── Verify liga admin ────────────────────────────────────────────────────────
async function isLigaAdmin(ligaId: string, userId: number): Promise<boolean> {
  const r = await pool.query(`SELECT id FROM ligas WHERE id=$1 AND admin_id=$2`, [ligaId, userId]);
  return r.rows.length > 0;
}

// =============================================================================
// LIGAS
// =============================================================================

// POST /ranking/ligas — admin cria sua liga
router.post('/ligas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (p.role !== 'admin') return res.status(403).json({ error: 'Apenas admins podem criar ligas.' });

  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'nome obrigatório.' });

  const r = await pool.query(
    `INSERT INTO ligas (admin_id, nome) VALUES ($1, $2) RETURNING *`,
    [p.user_id, nome.trim()],
  );
  res.status(201).json({ data: r.rows[0] });
});

// GET /ranking/ligas — ligas onde o usuário é admin ou membro
router.get('/ligas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT DISTINCT l.*,
            (l.admin_id = $1) AS is_admin,
            u.nome AS admin_nome,
            (SELECT t.id FROM temporadas t WHERE t.liga_id = l.id AND t.ativa = true LIMIT 1)
              AS temporada_ativa_id,
            (SELECT t.nome FROM temporadas t WHERE t.liga_id = l.id AND t.ativa = true LIMIT 1)
              AS temporada_ativa_nome,
            (SELECT COUNT(*) FROM membros_liga ml2 WHERE ml2.liga_id = l.id AND ml2.ativo = true)
              AS total_membros
     FROM ligas l
     JOIN users u ON u.id = l.admin_id
     LEFT JOIN membros_liga ml ON ml.liga_id = l.id AND ml.user_id = $1 AND ml.ativo = true
     WHERE l.admin_id = $1 OR ml.user_id = $1
     ORDER BY l.created_at DESC`,
    [p.user_id],
  );
  res.json({ data: r.rows });
});

// GET /ranking/ligas/:ligaId/membros — lista membros com dados do usuário
router.get('/ligas/:ligaId/membros', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT ml.id AS membro_id, ml.user_id, ml.classe, ml.ativo, ml.entrada_em,
            u.nome, u.email, u.foto_url
     FROM membros_liga ml
     JOIN users u ON u.id = ml.user_id
     WHERE ml.liga_id = $1 AND ml.ativo = true
     ORDER BY u.nome`,
    [req.params.ligaId],
  );
  res.json({ data: r.rows });
});

// POST /ranking/ligas/:ligaId/membros — admin adiciona membro por email
router.post('/ligas/:ligaId/membros', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (!(await isLigaAdmin(String(req.params.ligaId), p.user_id)))
    return res.status(403).json({ error: 'Apenas o admin da liga pode adicionar membros.' });

  const { email, classe } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatório.' });

  const u = await pool.query(`SELECT id FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
  if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const userId = u.rows[0].id;
  const r = await pool.query(
    `INSERT INTO membros_liga (liga_id, user_id, classe)
     VALUES ($1, $2, $3)
     ON CONFLICT (liga_id, user_id) DO UPDATE SET ativo=true, classe=EXCLUDED.classe
     RETURNING *`,
    [req.params.ligaId, userId, classe ?? 'intermediario'],
  );
  res.status(201).json({ data: r.rows[0] });
});

// DELETE /ranking/ligas/:ligaId/membros/:userId — admin remove membro
router.delete('/ligas/:ligaId/membros/:userId', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (!(await isLigaAdmin(String(req.params.ligaId), p.user_id)))
    return res.status(403).json({ error: 'Apenas o admin da liga pode remover membros.' });

  await pool.query(
    `UPDATE membros_liga SET ativo=false WHERE liga_id=$1 AND user_id=$2`,
    [req.params.ligaId, req.params.userId],
  );
  res.json({ data: { ok: true } });
});

// PATCH /ranking/ligas/:ligaId/membros/:userId — admin altera classe
router.patch('/ligas/:ligaId/membros/:userId', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (!(await isLigaAdmin(String(req.params.ligaId), p.user_id)))
    return res.status(403).json({ error: 'Apenas o admin da liga pode alterar classes.' });

  const { classe } = req.body;
  if (!classe) return res.status(400).json({ error: 'classe obrigatória.' });

  const r = await pool.query(
    `UPDATE membros_liga SET classe=$1 WHERE liga_id=$2 AND user_id=$3 RETURNING *`,
    [classe, req.params.ligaId, req.params.userId],
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ data: r.rows[0] });
});

// =============================================================================
// TEMPORADAS
// =============================================================================

// POST /ranking/ligas/:ligaId/temporadas — admin cria temporada
router.post('/ligas/:ligaId/temporadas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (!(await isLigaAdmin(String(req.params.ligaId), p.user_id)))
    return res.status(403).json({ error: 'Apenas o admin da liga pode criar temporadas.' });

  const { nome, data_inicio, data_fim } = req.body;
  if (!nome || !data_inicio || !data_fim)
    return res.status(400).json({ error: 'nome, data_inicio e data_fim obrigatórios.' });

  const ativa = await pool.query(
    `SELECT id FROM temporadas WHERE liga_id=$1 AND ativa=true`,
    [req.params.ligaId],
  );
  if (ativa.rows.length)
    return res.status(409).json({ error: 'Já existe uma temporada ativa nesta liga.' });

  const r = await pool.query(
    `INSERT INTO temporadas (liga_id, nome, data_inicio, data_fim)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.ligaId, nome.trim(), data_inicio, data_fim],
  );
  res.status(201).json({ data: r.rows[0] });
});

// GET /ranking/ligas/:ligaId/temporadas — lista temporadas
router.get('/ligas/:ligaId/temporadas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM partidas pa WHERE pa.temporada_id = t.id) AS total_partidas
     FROM temporadas t
     WHERE t.liga_id = $1
     ORDER BY t.created_at DESC`,
    [req.params.ligaId],
  );
  res.json({ data: r.rows });
});

// PATCH /ranking/ligas/:ligaId/temporadas/:id — encerra temporada
router.patch('/ligas/:ligaId/temporadas/:id', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (!(await isLigaAdmin(String(req.params.ligaId), p.user_id)))
    return res.status(403).json({ error: 'Apenas o admin da liga pode encerrar temporadas.' });

  const r = await pool.query(
    `UPDATE temporadas SET ativa=false WHERE id=$1 AND liga_id=$2 RETURNING *`,
    [req.params.id, req.params.ligaId],
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Temporada não encontrada.' });
  res.json({ data: r.rows[0] });
});

// =============================================================================
// PARTIDAS
// =============================================================================

// POST /ranking/partidas/mural — registra partida originada do Mural (busca adversário por email)
router.post('/partidas/mural', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const { temporada_id, email_b, placar, tipo_partida, wo, eu_ganhei, vencedor_e_a, data_partida } = req.body;
  if (!temporada_id || !email_b || !tipo_partida || !data_partida)
    return res.status(400).json({ error: 'temporada_id, email_b, tipo_partida e data_partida obrigatórios.' });

  const uB = await pool.query(`SELECT id FROM users WHERE email = $1`, [email_b.trim().toLowerCase()]);
  if (!uB.rows.length) return res.status(404).json({ error: 'Adversário não encontrado no sistema.' });
  const jogadorBId = uB.rows[0].id as number;
  const jogadorAId = p.user_id;

  if (jogadorAId === jogadorBId) return res.status(400).json({ error: 'Os dois jogadores devem ser diferentes.' });

  let vencedorId: number;
  if (wo) {
    vencedorId = eu_ganhei ? jogadorAId : jogadorBId;
  } else if (vencedor_e_a !== undefined) {
    vencedorId = vencedor_e_a ? jogadorAId : jogadorBId;
  } else {
    vencedorId = determinarVencedor(placar as SetScore[], jogadorAId, jogadorBId);
  }

  const { pontosA, pontosB, bonusA, bonusB } = calcularPontos(
    wo ? [] : (placar as SetScore[]),
    tipo_partida,
    Boolean(wo),
    vencedorId,
    jogadorAId,
    jogadorBId,
  );

  const r = await pool.query(
    `INSERT INTO partidas
       (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida,
        vencedor_id, wo, pontos_a, pontos_b, bonus_a, bonus_b, data_partida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [temporada_id, jogadorAId, jogadorBId, wo ? null : JSON.stringify(placar), tipo_partida,
     vencedorId, Boolean(wo), pontosA, pontosB, bonusA, bonusB, data_partida],
  );
  res.status(201).json({ data: r.rows[0] });
});

// =============================================================================
// RODADAS
// =============================================================================

// POST /ranking/rodadas — admin cria rodada e gera matchups automaticamente
router.post('/rodadas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (p.role !== 'admin') return res.status(403).json({ error: 'Apenas admins.' });

  const { temporada_id, participantes } = req.body as { temporada_id: string; participantes: number[] };
  if (!temporada_id || !Array.isArray(participantes) || participantes.length < 2)
    return res.status(400).json({ error: 'temporada_id e ao menos 2 participantes obrigatórios.' });

  // Busca temporada para verificar liga
  const temp = await pool.query(`SELECT * FROM temporadas WHERE id=$1`, [temporada_id]);
  if (!temp.rows.length) return res.status(404).json({ error: 'Temporada não encontrada.' });

  // Encerra rodada anterior ativa
  await pool.query(`UPDATE rodadas SET ativa=false WHERE temporada_id=$1`, [temporada_id]);

  // Cria nova rodada
  const countR = await pool.query(`SELECT COUNT(*) FROM rodadas WHERE temporada_id=$1`, [temporada_id]);
  const numero = parseInt(String(countR.rows[0].count)) + 1;
  const rodada = await pool.query(
    `INSERT INTO rodadas (temporada_id, numero) VALUES ($1,$2) RETURNING *`,
    [temporada_id, numero],
  );
  const rodadaId = rodada.rows[0].id;

  // Busca posições no ranking para ordenar participantes
  const posQuery = await pool.query(
    `SELECT u.id,
            COALESCE(SUM(
              CASE WHEN pa.jogador_a_id=u.id THEN pa.pontos_a+pa.bonus_a
                   WHEN pa.jogador_b_id=u.id THEN pa.pontos_b+pa.bonus_b ELSE 0 END
            ),0)::int AS total_pontos
     FROM users u
     LEFT JOIN partidas pa ON (pa.jogador_a_id=u.id OR pa.jogador_b_id=u.id)
       AND pa.temporada_id=$1 AND pa.status IN ('confirmada','disputada_admin')
     WHERE u.id = ANY($2::int[])
     GROUP BY u.id
     ORDER BY total_pontos DESC`,
    [temporada_id, participantes],
  );

  const ordered = posQuery.rows.map((r: { id: number }) => r.id);
  const curingaId: number | null = ordered.length % 2 !== 0 ? ordered.pop()! : null;

  // Gera matchups: pareamento por posição adjacente (mais alto vs segundo mais alto, etc.)
  const inseridos = [];
  for (let i = 0; i < ordered.length; i += 2) {
    const desadoId = ordered[i];     // mais alto no ranking = desafiado
    const desaId   = ordered[i + 1]; // mais abaixo = desafiante
    const r = await pool.query(
      `INSERT INTO partidas
         (temporada_id, jogador_a_id, jogador_b_id, tipo_partida, data_partida,
          wo, pontos_a, pontos_b, bonus_a, bonus_b, rodada_id)
       VALUES ($1,$2,$3,'melhor_de_3',NOW()::date,false,0,0,0,0,$4) RETURNING *`,
      [temporada_id, desaId, desadoId, rodadaId],
    );
    inseridos.push(r.rows[0]);
  }

  res.status(201).json({ data: { rodada: rodada.rows[0], matchups: inseridos, curinga: curingaId } });
});

// GET /ranking/temporadas/:temporadaId/rodadas — lista rodadas da temporada
router.get('/temporadas/:temporadaId/rodadas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT ro.*,
            (SELECT COUNT(*) FROM partidas pa WHERE pa.rodada_id = ro.id) AS total_matchups
     FROM rodadas ro WHERE ro.temporada_id=$1 ORDER BY ro.numero DESC`,
    [String(req.params.temporadaId)],
  );
  res.json({ data: r.rows });
});

// GET /ranking/rodadas/:id/matchups — matchups de uma rodada com nomes
router.get('/rodadas/:id/matchups', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT pa.*,
            ua.nome AS jogador_a_nome, ua.foto_url AS jogador_a_foto,
            ub.nome AS jogador_b_nome, ub.foto_url AS jogador_b_foto,
            uv.nome AS vencedor_nome
     FROM partidas pa
     JOIN users ua ON ua.id = pa.jogador_a_id
     JOIN users ub ON ub.id = pa.jogador_b_id
     LEFT JOIN users uv ON uv.id = pa.vencedor_id
     WHERE pa.rodada_id=$1
     ORDER BY pa.created_at`,
    [String(req.params.id)],
  );
  res.json({ data: r.rows });
});

// PATCH /ranking/rodadas/:id/encerrar — admin encerra rodada
router.patch('/rodadas/:id/encerrar', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (p.role !== 'admin') return res.status(403).json({ error: 'Apenas admins.' });

  const r = await pool.query(`UPDATE rodadas SET ativa=false WHERE id=$1 RETURNING *`, [String(req.params.id)]);
  if (!r.rows.length) return res.status(404).json({ error: 'Rodada não encontrada.' });
  res.json({ data: r.rows[0] });
});

// GET /ranking/partidas/pendentes — partidas aguardando minha confirmação
router.get('/partidas/pendentes', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT pa.*,
            ua.nome AS jogador_a_nome, ua.foto_url AS jogador_a_foto,
            ub.nome AS jogador_b_nome, ub.foto_url AS jogador_b_foto,
            uv.nome AS vencedor_nome
     FROM partidas pa
     JOIN users ua ON ua.id = pa.jogador_a_id
     JOIN users ub ON ub.id = pa.jogador_b_id
     LEFT JOIN users uv ON uv.id = pa.vencedor_id
     WHERE pa.status = 'pendente'
       AND (pa.jogador_a_id=$1 OR pa.jogador_b_id=$1)
       AND (
         (pa.jogador_a_id=$1 AND pa.confirmado_a=false) OR
         (pa.jogador_b_id=$1 AND pa.confirmado_b=false)
       )
     ORDER BY pa.created_at DESC`,
    [p.user_id],
  );
  res.json({ data: r.rows });
});

// POST /ranking/partidas — registra partida e calcula pontos
router.post('/partidas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const {
    temporada_id, jogador_a_id, jogador_b_id,
    placar, tipo_partida, wo, wo_vencedor_id, data_partida,
  } = req.body;

  if (!temporada_id || !jogador_a_id || !jogador_b_id || !tipo_partida || !data_partida)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  if (jogador_a_id === jogador_b_id)
    return res.status(400).json({ error: 'Os dois jogadores devem ser diferentes.' });

  if (wo && !wo_vencedor_id)
    return res.status(400).json({ error: 'wo_vencedor_id obrigatório em WO.' });

  if (!wo && (!placar || !Array.isArray(placar) || placar.length === 0))
    return res.status(400).json({ error: 'placar obrigatório quando não é WO.' });

  const vencedorId: number = wo
    ? Number(wo_vencedor_id)
    : determinarVencedor(placar as SetScore[], Number(jogador_a_id), Number(jogador_b_id));

  const { pontosA, pontosB, bonusA, bonusB } = calcularPontos(
    wo ? [] : (placar as SetScore[]),
    tipo_partida,
    Boolean(wo),
    vencedorId,
    Number(jogador_a_id),
    Number(jogador_b_id),
  );

  const r = await pool.query(
    `INSERT INTO partidas
       (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida,
        vencedor_id, wo, pontos_a, pontos_b, bonus_a, bonus_b, data_partida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      temporada_id, jogador_a_id, jogador_b_id,
      wo ? null : JSON.stringify(placar), tipo_partida,
      vencedorId, Boolean(wo),
      pontosA, pontosB, bonusA, bonusB, data_partida,
    ],
  );
  res.status(201).json({ data: r.rows[0] });
});

// GET /ranking/temporadas/:temporadaId/partidas — lista partidas com nomes dos jogadores
router.get('/temporadas/:temporadaId/partidas', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const r = await pool.query(
    `SELECT pa.*,
            ua.nome AS jogador_a_nome, ua.foto_url AS jogador_a_foto,
            ub.nome AS jogador_b_nome, ub.foto_url AS jogador_b_foto,
            uv.nome AS vencedor_nome
     FROM partidas pa
     JOIN users ua ON ua.id = pa.jogador_a_id
     JOIN users ub ON ub.id = pa.jogador_b_id
     LEFT JOIN users uv ON uv.id = pa.vencedor_id
     WHERE pa.temporada_id = $1
     ORDER BY pa.data_partida DESC, pa.created_at DESC`,
    [req.params.temporadaId],
  );
  res.json({ data: r.rows });
});

// PATCH /ranking/partidas/:id/confirmar — confirmação individual; só vira 'confirmada' quando os 2 confirmam
router.patch('/partidas/:id/confirmar', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const partida = await pool.query(`SELECT * FROM partidas WHERE id=$1`, [String(req.params.id)]);
  if (!partida.rows.length) return res.status(404).json({ error: 'Partida não encontrada.' });

  const pd = partida.rows[0];
  if (pd.jogador_a_id !== p.user_id && pd.jogador_b_id !== p.user_id)
    return res.status(403).json({ error: 'Você não é um dos jogadores desta partida.' });

  const { confirmar } = req.body;

  if (!confirmar) {
    const r = await pool.query(
      `UPDATE partidas SET status='disputada_admin' WHERE id=$1 RETURNING *`,
      [String(req.params.id)],
    );
    return res.json({ data: r.rows[0] });
  }

  // Marca confirmação do jogador atual
  const isA = pd.jogador_a_id === p.user_id;
  const col  = isA ? 'confirmado_a' : 'confirmado_b';
  await pool.query(`UPDATE partidas SET ${col}=true WHERE id=$1`, [String(req.params.id)]);

  // Verifica se ambos confirmaram
  const updated = await pool.query(`SELECT * FROM partidas WHERE id=$1`, [String(req.params.id)]);
  const up = updated.rows[0];
  if (up.confirmado_a && up.confirmado_b) {
    await pool.query(`UPDATE partidas SET status='confirmada' WHERE id=$1`, [String(req.params.id)]);
    up.status = 'confirmada';
  }

  res.json({ data: up });
});

// PATCH /ranking/partidas/:id/admin — admin resolve disputa
router.patch('/partidas/:id/admin', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });
  if (p.role !== 'admin') return res.status(403).json({ error: 'Apenas admins.' });

  const { vencedor_id, placar } = req.body;
  if (!vencedor_id) return res.status(400).json({ error: 'vencedor_id obrigatório.' });

  const partida = await pool.query(`SELECT * FROM partidas WHERE id=$1`, [req.params.id]);
  if (!partida.rows.length) return res.status(404).json({ error: 'Partida não encontrada.' });
  const pd = partida.rows[0];

  const finalPlacar = placar ?? pd.placar;
  const { pontosA, pontosB, bonusA, bonusB } = calcularPontos(
    pd.wo ? [] : (finalPlacar as SetScore[]),
    pd.tipo_partida,
    pd.wo,
    Number(vencedor_id),
    pd.jogador_a_id,
    pd.jogador_b_id,
  );

  const r = await pool.query(
    `UPDATE partidas
     SET status='disputada_admin', vencedor_id=$1, placar=$2,
         pontos_a=$3, pontos_b=$4, bonus_a=$5, bonus_b=$6
     WHERE id=$7 RETURNING *`,
    [vencedor_id, finalPlacar ? JSON.stringify(finalPlacar) : null, pontosA, pontosB, bonusA, bonusB, req.params.id],
  );
  res.json({ data: r.rows[0] });
});

// =============================================================================
// RANKING (tabela calculada dinamicamente)
// =============================================================================

// GET /ranking/temporadas/:temporadaId/tabela?classe= — tabela de pontos
router.get('/temporadas/:temporadaId/tabela', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const { classe } = req.query as Record<string, string>;
  const params: (string | null)[] = [String(req.params.temporadaId)];
  let classeWhere = '';
  if (classe) {
    params.push(classe);
    classeWhere = `AND ml.classe = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT
       u.id,
       u.nome,
       u.foto_url,
       ml.classe,
       COALESCE(SUM(
         CASE
           WHEN pa.jogador_a_id = u.id THEN (pa.pontos_a + pa.bonus_a)
           WHEN pa.jogador_b_id = u.id THEN (pa.pontos_b + pa.bonus_b)
           ELSE 0
         END
       ), 0)::int AS total_pontos,
       COUNT(pa.id)::int AS jogos,
       COUNT(CASE WHEN pa.vencedor_id = u.id THEN 1 END)::int AS vitorias,
       COUNT(CASE
         WHEN pa.vencedor_id IS NOT NULL AND pa.vencedor_id != u.id THEN 1
       END)::int AS derrotas
     FROM membros_liga ml
     JOIN users u ON u.id = ml.user_id
     LEFT JOIN partidas pa ON
       (pa.jogador_a_id = u.id OR pa.jogador_b_id = u.id)
       AND pa.temporada_id = $1
       AND pa.status IN ('confirmada', 'disputada_admin')
     WHERE ml.liga_id = (SELECT liga_id FROM temporadas WHERE id = $1)
       AND ml.ativo = true
       ${classeWhere}
     GROUP BY u.id, u.nome, u.foto_url, ml.classe
     ORDER BY total_pontos DESC, vitorias DESC, derrotas ASC, u.nome ASC`,
    params,
  );
  res.json({ data: r.rows });
});

// =============================================================================
// DESAFIOS
// =============================================================================

// POST /ranking/desafios — aluno desafia outro membro da liga
router.post('/desafios', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const { liga_id, desafiado_id, data_sugerida, horario_sugerido, local_sugerido } = req.body;
  if (!liga_id || !desafiado_id || !data_sugerida || !horario_sugerido || !local_sugerido)
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  if (p.user_id === Number(desafiado_id))
    return res.status(400).json({ error: 'Você não pode se desafiar.' });

  const r = await pool.query(
    `INSERT INTO desafios
       (liga_id, desafiante_id, desafiado_id, data_sugerida, horario_sugerido, local_sugerido)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [liga_id, p.user_id, desafiado_id, data_sugerida, horario_sugerido, local_sugerido],
  );
  res.status(201).json({ data: r.rows[0] });
});

// GET /ranking/desafios?ligaId= — desafios do usuário (enviados e recebidos)
router.get('/desafios', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const ligaId = String((req.query as Record<string, string>).ligaId ?? '');
  if (!ligaId) return res.status(400).json({ error: 'ligaId obrigatório.' });

  const r = await pool.query(
    `SELECT d.*,
            ua.nome AS desafiante_nome, ua.foto_url AS desafiante_foto,
            ub.nome AS desafiado_nome,  ub.foto_url AS desafiado_foto
     FROM desafios d
     JOIN users ua ON ua.id = d.desafiante_id
     JOIN users ub ON ub.id = d.desafiado_id
     WHERE d.liga_id = $1
       AND (d.desafiante_id = $2 OR d.desafiado_id = $2)
     ORDER BY d.created_at DESC`,
    [ligaId, p.user_id],
  );
  res.json({ data: r.rows });
});

// PATCH /ranking/desafios/:id — aceitar, recusar ou contrapropor
router.patch('/desafios/:id', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const { status, contra_data, contra_horario, contra_local } = req.body;
  const valid = ['aceito', 'recusado', 'contraproposto'];
  if (!valid.includes(status))
    return res.status(400).json({ error: `status deve ser: ${valid.join(', ')}.` });

  const r = await pool.query(
    `UPDATE desafios
     SET status=$1, contra_data=$2, contra_horario=$3, contra_local=$4
     WHERE id=$5
       AND (desafiante_id=$6 OR desafiado_id=$6)
     RETURNING *`,
    [status, contra_data ?? null, contra_horario ?? null, contra_local ?? null, req.params.id, p.user_id],
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Desafio não encontrado.' });
  res.json({ data: r.rows[0] });
});

// POST /ranking/desafios/:id/partida — converte desafio aceito em partida
router.post('/desafios/:id/partida', async (req: Request, res: Response) => {
  const p = getAuth(req);
  if (!p) return res.status(401).json({ error: 'Token ausente.' });

  const desafio = await pool.query(`SELECT * FROM desafios WHERE id=$1`, [req.params.id]);
  if (!desafio.rows.length) return res.status(404).json({ error: 'Desafio não encontrado.' });
  const d = desafio.rows[0];
  if (d.status !== 'aceito') return res.status(400).json({ error: 'Desafio não foi aceito ainda.' });

  const { temporada_id, placar, tipo_partida, wo, wo_vencedor_id, data_partida } = req.body;
  if (!temporada_id || !tipo_partida || !data_partida)
    return res.status(400).json({ error: 'temporada_id, tipo_partida e data_partida obrigatórios.' });

  const vencedorId: number = wo
    ? Number(wo_vencedor_id)
    : determinarVencedor(placar as SetScore[], d.desafiante_id, d.desafiado_id);

  const { pontosA, pontosB, bonusA, bonusB } = calcularPontos(
    wo ? [] : (placar as SetScore[]),
    tipo_partida,
    Boolean(wo),
    vencedorId,
    d.desafiante_id,
    d.desafiado_id,
  );

  const partida = await pool.query(
    `INSERT INTO partidas
       (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida,
        vencedor_id, wo, pontos_a, pontos_b, bonus_a, bonus_b, data_partida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      temporada_id, d.desafiante_id, d.desafiado_id,
      wo ? null : JSON.stringify(placar), tipo_partida,
      vencedorId, Boolean(wo),
      pontosA, pontosB, bonusA, bonusB, data_partida,
    ],
  );

  await pool.query(
    `UPDATE desafios SET partida_id=$1 WHERE id=$2`,
    [partida.rows[0].id, req.params.id],
  );

  res.status(201).json({ data: partida.rows[0] });
});

export { router as rankingRouter };
