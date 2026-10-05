// =============================================================================
// TENIS-BACK — Entry point
// =============================================================================
import express from 'express';
// Erros em handlers async vão para o error handler em vez de derrubar o processo
import 'express-async-errors';
import cors    from 'cors';
import { clipsRouter }    from './routes/clips';
import { gabaritoRouter } from './routes/gabarito';
import { jogosRouter }    from './routes/jogos';
import { authRouter }     from './routes/authRoutes';
import { agendaRouter }   from './routes/agenda';
import { quadrasRouter }  from './routes/quadras';
import { rankingRouter }  from './routes/ranking';
import { paymentRouter }  from './routes/paymentRoutes';

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── COOP/COEP headers (necessário para Google OAuth popup) ──────────────────
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/clips',    clipsRouter);
app.use('/gabarito', gabaritoRouter);
app.use('/jogos',    jogosRouter);
app.use('/auth',     authRouter);
app.use('/agenda',   agendaRouter);
app.use('/quadras',  quadrasRouter);
app.use('/ranking',  rankingRouter);
app.use('/payment',  paymentRouter);

// ── Error handler global — responde 500 em vez de derrubar o servidor ──────
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[Erro] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno.' });
});

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

app.listen(PORT, () => console.log(`tenis-back rodando na porta ${PORT}`));
