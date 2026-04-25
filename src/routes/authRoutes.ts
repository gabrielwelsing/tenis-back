import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET ?? 'floquinho1@';

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { nome, email, password } = req.body;
  if (!nome || !email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: nome, email, password.' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      `INSERT INTO users (nome, email, password_hash, role)
       VALUES ($1, $2, $3, 'user') RETURNING id, nome, email, role`,
      [nome.trim(), email.trim().toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    return res.status(201).json({ token, user });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado.' });
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: email, password.' });

  const result = await pool.query(
    `SELECT id, nome, email, role, password_hash, active FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.active) return res.status(403).json({ error: 'Conta desativada.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const token = jwt.sign({ user_id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  return res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, role: user.role } });
});

// GET /auth/me — valida token e retorna dados do usuário
router.get('/me', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { user_id: number; role: string };
    const result = await pool.query(
      `SELECT id, nome, email, role, active FROM users WHERE id = $1`,
      [payload.user_id]
    );
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido.' });
    return res.json({ user });
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
});

export { router as authRouter };
