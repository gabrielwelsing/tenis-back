// =============================================================================
// TENIS-BACK — Entry point
// =============================================================================

import express from 'express';
import cors    from 'cors';
import { clipsRouter } from './routes/clips';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/clips', clipsRouter);

app.listen(PORT, () => console.log(`tenis-back rodando na porta ${PORT}`));
