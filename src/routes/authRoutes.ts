import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const router    = Router();
const pool      = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET   = process.env.JWT_SECRET ?? 'floquinho1@';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ---------------------------------------------------------------------------
// Helper — formata usuário pra resposta
// ---------------------------------------------------------------------------
function formatUser(u: any) {
  return {
    id:              u.id,
    nome:            u.nome,
    email:           u.email,
    role:            u.role,
    foto_url:        u.foto_url ?? null,
    localidade:      u.localidade ?? null,
    telefone:        u.telefone ?? null,
    plano_expira_em: u.plano_expira_em ?? null,
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

async function getAdminFromRequest(req: Request) {
  const token = getBearerToken(req);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { user_id: number; role: string };

    const result = await pool.query(
      `SELECT id, nome, email, role, active
       FROM users
       WHERE id = $1`,
      [payload.user_id]
    );

    const admin = result.rows[0];

    if (!admin || !admin.active || admin.role !== 'admin') return null;

    return admin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
router.post('/register', async (req: Request, res: Response) => {
  const { nome, email, password, localidade, telefone } = req.body;
  if (!nome || !email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: nome, email, password.' });

  const hash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      `INSERT INTO users (nome, email, password_hash, role, localidade, telefone)
       VALUES ($1, $2, $3, 'user', $4, $5)
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em`,
      [nome.trim(), email.trim().toLowerCase(), hash, localidade ?? null, telefone ?? null]
    );

    const user  = result.rows[0];
    const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    return res.status(201).json({ token, user: formatUser(user) });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado.' });
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: email, password.' });

  const result = await pool.query(
    `SELECT id, nome, email, role, password_hash, active, foto_url, localidade, telefone, plano_expira_em
     FROM users
     WHERE email = $1`,
    [email.trim().toLowerCase()]
  );

  const user = result.rows[0];

  if (!user)        return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.active) return res.status(403).json({ error: 'Conta desativada.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

  return res.json({ token, user: formatUser(user) });
});

// ---------------------------------------------------------------------------
// POST /auth/google — login/cadastro via Google OAuth
// ---------------------------------------------------------------------------
router.post('/google', async (req: Request, res: Response) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Token Google ausente.' });

  try {
    const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();

    if (!payload?.email) return res.status(400).json({ error: 'Token Google inválido.' });

    const { email, name, picture, sub: googleId } = payload;

    const existing = await pool.query(
      `SELECT id, nome, email, role, active, foto_url, localidade, telefone, plano_expira_em
       FROM users
       WHERE email = $1 OR google_id = $2`,
      [email.trim().toLowerCase(), googleId]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];

      if (!user.active) return res.status(403).json({ error: 'Conta desativada.' });

      await pool.query(
        `UPDATE users
         SET google_id = $1,
             foto_url = COALESCE(foto_url, $2),
             updated_at = NOW()
         WHERE id = $3`,
        [googleId, picture ?? null, user.id]
      );

      user.foto_url = user.foto_url ?? picture ?? null;

      const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

      return res.json({ token, user: formatUser(user) });
    }

    const created = await pool.query(
      `INSERT INTO users (nome, email, role, google_id, foto_url)
       VALUES ($1, $2, 'user', $3, $4)
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em`,
      [name ?? email.split('@')[0], email.trim().toLowerCase(), googleId, picture ?? null]
    );

    const newUser = created.rows[0];
    const token   = jwt.sign({ user_id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '30d' });

    return res.status(201).json({ token, user: formatUser(newUser) });
  } catch (e) {
    console.error('[Google Auth]', e);
    return res.status(401).json({ error: 'Falha na autenticação com Google.' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/users/search?q=nome — busca usuários ativos para autocomplete geral
// ---------------------------------------------------------------------------
router.get('/users/search', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();

  if (q.length < 2) return res.json([]);

  try {
    const result = await pool.query(
      `SELECT id, nome, email, foto_url, telefone
       FROM users
       WHERE active = true
         AND (
           LOWER(nome) LIKE LOWER($1)
           OR LOWER(email) LIKE LOWER($1)
         )
       ORDER BY nome ASC
       LIMIT 8`,
      [q + '%']
    );

    return res.json(result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      foto_url: u.foto_url ?? null,
      telefone: u.telefone ?? null,
    })));
  } catch (e) {
    console.error('[Auth users search]', e);
    return res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/admin/users/search?q=yu
// Busca somente usuários role='user' para liberar PRO manualmente
// ---------------------------------------------------------------------------
router.get('/admin/users/search', async (req: Request, res: Response) => {
  const admin = await getAdminFromRequest(req);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const q = String(req.query.q ?? req.query.query ?? '').trim();

  if (q.length < 2) return res.json([]);

  try {
    const result = await pool.query(
      `SELECT id, nome, email, role, foto_url, telefone, plano_expira_em
       FROM users
       WHERE active = true
         AND role = 'user'
         AND (
           LOWER(nome) LIKE LOWER($1)
           OR LOWER(email) LIKE LOWER($1)
         )
       ORDER BY nome ASC
       LIMIT 10`,
      [q + '%']
    );

    return res.json(result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.role,
      foto_url: u.foto_url ?? null,
      telefone: u.telefone ?? null,
      plano_expira_em: u.plano_expira_em ?? null,
    })));
  } catch (e) {
    console.error('[Admin users search]', e);
    return res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /auth/admin/users/:id/liberar-pro
// Admin libera PRO manualmente por quantidade de dias a partir de hoje
// ---------------------------------------------------------------------------
router.patch('/admin/users/:id/liberar-pro', async (req: Request, res: Response) => {
  const admin = await getAdminFromRequest(req);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const userId = Number(req.params.id);
  const dias = Number(req.body?.dias);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Usuário inválido.' });
  }

  if (!Number.isInteger(dias) || dias <= 0 || dias > 365) {
    return res.status(400).json({ error: 'Informe uma quantidade de dias entre 1 e 365.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = 'aluno',
           plano_expira_em = (CURRENT_DATE + ($2::int * INTERVAL '1 day'))::date,
           updated_at = NOW()
       WHERE id = $1
         AND active = true
         AND role = 'user'
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em`,
      [userId, dias]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado ou já não está como plano gratuito.' });
    }

    return res.json({
      ok: true,
      user: formatUser(result.rows[0]),
    });
  } catch (e) {
    console.error('[Admin liberar PRO]', e);
    return res.status(500).json({ error: 'Erro ao liberar acesso PRO.' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { user_id: number; role: string };

    const result = await pool.query(
      `SELECT id, nome, email, role, active, foto_url, localidade, telefone, plano_expira_em
       FROM users
       WHERE id = $1`,
      [payload.user_id]
    );

    const user = result.rows[0];

    if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido.' });

    return res.json({ user: formatUser(user) });
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /auth/profile — atualiza perfil do usuário
// ---------------------------------------------------------------------------
router.patch('/profile', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { user_id: number };
    const { nome, localidade, telefone, foto_url } = req.body;

    const result = await pool.query(
      `UPDATE users SET
        nome       = COALESCE($1, nome),
        localidade = COALESCE($2, localidade),
        telefone   = COALESCE($3, telefone),
        foto_url   = COALESCE($4, foto_url),
        updated_at = NOW()
       WHERE id = $5
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em`,
      [nome ?? null, localidade ?? null, telefone ?? null, foto_url ?? null, payload.user_id]
    );

    return res.json({ user: formatUser(result.rows[0]) });
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
});

export { router as authRouter };
