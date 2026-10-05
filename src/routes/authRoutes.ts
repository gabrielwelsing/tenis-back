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
    username:        u.username ?? null,
    primeiro_acesso: Boolean(u.primeiro_acesso),
  };
}

const USERNAME_REGEX = /^[a-z0-9._-]{3,30}$/;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENHA_MIN      = 6;

function signToken(user: { id: number; role: string }) {
  return jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
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
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
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
  // "email" aceita e-mail ou usuário (contas criadas pelo professor)
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: email, password.' });

  const identificador = String(email).trim().toLowerCase();
  const porEmail      = identificador.includes('@');

  const result = await pool.query(
    `SELECT id, nome, email, role, password_hash, active, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso
     FROM users
     WHERE ${porEmail ? 'email = $1' : 'LOWER(username) = $1'}`,
    [identificador]
  );

  const user = result.rows[0];

  if (!user)        return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.active) return res.status(403).json({ error: 'Conta desativada.' });
  if (!user.password_hash) return res.status(401).json({ error: 'Esta conta entra com Google.' });

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
      `SELECT id, nome, email, role, active, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso
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
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
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
         AND primeiro_acesso = false
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
      `SELECT id, nome, email, username, role, foto_url, telefone, plano_expira_em
       FROM users
       WHERE active = true
         AND role = 'user'
         AND (
           LOWER(nome) LIKE LOWER($1)
           OR LOWER(email) LIKE LOWER($1)
           OR LOWER(username) LIKE LOWER($1)
         )
       ORDER BY nome ASC
       LIMIT 10`,
      [q + '%']
    );

    return res.json(result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      username: u.username ?? null,
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
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
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
// POST /auth/admin/users
// Professor cria conta com usuário + senha provisória (sem e-mail).
// O aluno vincula o e-mail e troca a senha no primeiro acesso.
// ---------------------------------------------------------------------------
router.post('/admin/users', async (req: Request, res: Response) => {
  const admin = await getAdminFromRequest(req);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const nome       = String(req.body?.nome ?? '').trim();
  const username   = String(req.body?.username ?? '').trim().toLowerCase();
  const senha      = String(req.body?.senha ?? '');
  const plano      = req.body?.plano === 'aluno' ? 'aluno' : 'user';
  const dias       = Number(req.body?.dias);
  const telefone   = String(req.body?.telefone ?? '').trim() || null;
  const localidade = String(req.body?.localidade ?? '').trim() || null;

  if (!nome) return res.status(400).json({ error: 'Informe o nome do aluno.' });
  if (!USERNAME_REGEX.test(username))
    return res.status(400).json({ error: 'Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou underline.' });
  if (senha.length < SENHA_MIN)
    return res.status(400).json({ error: `A senha provisória deve ter pelo menos ${SENHA_MIN} caracteres.` });
  if (plano === 'aluno' && (!Number.isInteger(dias) || dias <= 0 || dias > 365))
    return res.status(400).json({ error: 'Informe uma quantidade de dias de PRO entre 1 e 365.' });

  const hash = await bcrypt.hash(senha, 10);

  try {
    const result = await pool.query(
      `INSERT INTO users (nome, username, password_hash, role, telefone, localidade, plano_expira_em, primeiro_acesso, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $4 = 'aluno' THEN (CURRENT_DATE + ($7::int * INTERVAL '1 day'))::date ELSE NULL END,
               true, $8)
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
      [nome, username, hash, plano, telefone, localidade, plano === 'aluno' ? dias : 0, admin.id]
    );

    return res.status(201).json({ ok: true, user: formatUser(result.rows[0]) });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Esse usuário já existe. Escolha outro.' });
    console.error('[Admin criar usuário]', e);
    return res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/admin/users/pendentes — contas que ainda não fizeram o 1º acesso
// ---------------------------------------------------------------------------
router.get('/admin/users/pendentes', async (req: Request, res: Response) => {
  const admin = await getAdminFromRequest(req);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  try {
    const result = await pool.query(
      `SELECT id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso
       FROM users
       WHERE active = true AND primeiro_acesso = true
       ORDER BY id DESC
       LIMIT 50`
    );

    return res.json(result.rows.map(formatUser));
  } catch (e) {
    console.error('[Admin pendentes]', e);
    return res.status(500).json({ error: 'Erro ao listar contas pendentes.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /auth/admin/users/:id/senha-provisoria
// Redefine a senha provisória de uma conta que ainda não fez o 1º acesso
// ---------------------------------------------------------------------------
router.patch('/admin/users/:id/senha-provisoria', async (req: Request, res: Response) => {
  const admin = await getAdminFromRequest(req);
  if (!admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' });

  const userId = Number(req.params.id);
  const senha  = String(req.body?.senha ?? '');

  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (senha.length < SENHA_MIN)
    return res.status(400).json({ error: `A senha provisória deve ter pelo menos ${SENHA_MIN} caracteres.` });

  try {
    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $2, updated_at = NOW()
       WHERE id = $1 AND active = true AND primeiro_acesso = true
       RETURNING id`,
      [userId, hash]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Conta não encontrada ou já ativada pelo aluno.' });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Admin senha provisória]', e);
    return res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/primeiro-acesso
// Aluno criado pelo professor define a própria senha e vincula o e-mail
// (digitado ou via Google — `credential`).
// ---------------------------------------------------------------------------
router.post('/primeiro-acesso', async (req: Request, res: Response) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  let userId: number;
  try {
    userId = (jwt.verify(token, JWT_SECRET) as { user_id: number }).user_id;
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const novaSenha  = String(req.body?.nova_senha ?? '');
  const credential = req.body?.credential ? String(req.body.credential) : null;

  if (novaSenha.length < SENHA_MIN)
    return res.status(400).json({ error: `A nova senha deve ter pelo menos ${SENHA_MIN} caracteres.` });

  let email: string;
  let googleId: string | null = null;
  let picture:  string | null = null;

  if (credential) {
    try {
      const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.email) return res.status(400).json({ error: 'Token Google inválido.' });
      email    = payload.email.trim().toLowerCase();
      googleId = payload.sub ?? null;
      picture  = payload.picture ?? null;
    } catch (e) {
      console.error('[Primeiro acesso Google]', e);
      return res.status(401).json({ error: 'Falha ao validar a conta Google.' });
    }
  } else {
    email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  }

  try {
    const atual = await pool.query(`SELECT id, active, primeiro_acesso FROM users WHERE id = $1`, [userId]);
    const user  = atual.rows[0];

    if (!user || !user.active)  return res.status(401).json({ error: 'Usuário inválido.' });
    if (!user.primeiro_acesso)  return res.status(400).json({ error: 'Esta conta já foi ativada.' });

    const conflito = await pool.query(
      `SELECT id FROM users WHERE id <> $1 AND (email = $2 OR ($3::text IS NOT NULL AND google_id = $3))`,
      [userId, email, googleId]
    );
    if (conflito.rows.length)
      return res.status(409).json({ error: 'Este e-mail já está em uso por outra conta. Fale com o professor.' });

    const hash   = await bcrypt.hash(novaSenha, 10);
    const result = await pool.query(
      `UPDATE users SET
         email           = $2,
         password_hash   = $3,
         google_id       = COALESCE($4, google_id),
         foto_url        = COALESCE(foto_url, $5),
         primeiro_acesso = false,
         updated_at      = NOW()
       WHERE id = $1
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
      [userId, email, hash, googleId, picture]
    );

    const atualizado = result.rows[0];
    return res.json({ token: signToken(atualizado), user: formatUser(atualizado) });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Este e-mail já está em uso por outra conta. Fale com o professor.' });
    console.error('[Primeiro acesso]', e);
    return res.status(500).json({ error: 'Erro ao concluir o primeiro acesso.' });
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
      `SELECT id, nome, email, role, active, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso
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
       RETURNING id, nome, email, role, foto_url, localidade, telefone, plano_expira_em, username, primeiro_acesso`,
      [nome ?? null, localidade ?? null, telefone ?? null, foto_url ?? null, payload.user_id]
    );

    return res.json({ user: formatUser(result.rows[0]) });
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
});

export { router as authRouter };
