// =============================================================================
// TENIS-BACK — Entry point
// =============================================================================
import express from 'express';
import cors    from 'cors';
import { clipsRouter }    from './routes/clips';
import { gabaritoRouter } from './routes/gabarito';
import { jogosRouter }    from './routes/jogos';
import { authRouter }     from './routes/authRoutes';
import { agendaRouter }   from './routes/agenda';
import { quadrasRouter }  from './routes/quadras';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/clips',    clipsRouter);
app.use('/gabarito', gabaritoRouter);
app.use('/jogos',    jogosRouter);
app.use('/auth',     authRouter);
app.use('/agenda',   agendaRouter);
app.use('/quadras',  quadrasRouter);

app.listen(PORT, () => console.log(`tenis-back rodando na porta ${PORT}`));
