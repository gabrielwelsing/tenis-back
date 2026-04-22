// =============================================================================
// TENIS-BACK — Entry point
// =============================================================================

import express from 'express';
import cors    from 'cors';
import { clipsRouter }    from './routes/clips';
import { gabaritoRouter } from './routes/gabarito';

const app  = express();
const PORT = process.env.PORT ?? 3000;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://tenis-front-production.up.railway.app',
  'https://tenis.sup-ia.com',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado: ${origin}`));
  },
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/clips',    clipsRouter);
app.use('/gabarito', gabaritoRouter);

app.listen(PORT, () => console.log(`tenis-back rodando na porta ${PORT}`));
