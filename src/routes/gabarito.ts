// =============================================================================
// GABARITO — Referências biomecânicas por golpe+fase
// Estrutura: golpe_fase → { imageUrl, imageCredit, niveis: nivel → metas }
// Ângulos calibrados para vista LATERAL (plano sagital)
// =============================================================================

import { Router } from 'express';

const router = Router();

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type NivelAluno = 'iniciante' | 'intermediario' | 'avancado';

interface JointMeta {
  label: string;
  ideal: number;
  tolerancia: number;
  peso: number;
}

interface NivelConfig {
  metas: {
    elbow: JointMeta;
    knee:  JointMeta;
    hip:   JointMeta;
  };
}

interface GabaritoEntry {
  label:       string;
  grupo:       string;
  fase:        string;
  imageUrl:    string;
  imageCredit: string;
  niveis:      Record<NivelAluno, NivelConfig>;
}

// ---------------------------------------------------------------------------
// Multiplicadores de tolerância por nível
// Iniciante mais maleável: erros grandes são normais, score não deve punir tanto
// ---------------------------------------------------------------------------

const TOLE_MULT: Record<NivelAluno, number> = {
  iniciante:     4.0, // muito maleável — professor/iniciante não precisa de ângulo perfeito
  intermediario: 1.5, // levemente mais generoso que o padrão biomecânico
  avancado:      0.4, // exigente — foco em precisão técnica
};

// ---------------------------------------------------------------------------
// Helper: gera os 3 níveis a partir dos dados base do golpe
// ---------------------------------------------------------------------------

interface GolpeBase {
  label:       string;
  grupo:       string;
  fase:        string;
  imageUrl:    string;
  imageCredit: string;
  ideais: { elbow: number; knee: number; hip: number };
  toles:  { elbow: number; knee: number; hip: number };
  pesos:  { elbow: number; knee: number; hip: number };
}

function makeNiveis(base: GolpeBase): Record<NivelAluno, NivelConfig> {
  const niveis = {} as Record<NivelAluno, NivelConfig>;
  (Object.keys(TOLE_MULT) as NivelAluno[]).forEach((nivel) => {
    const mult = TOLE_MULT[nivel];
    niveis[nivel] = {
      metas: {
        elbow: { label: 'Cotovelo', ideal: base.ideais.elbow, tolerancia: Math.round(base.toles.elbow * mult), peso: base.pesos.elbow },
        knee:  { label: 'Joelho',   ideal: base.ideais.knee,  tolerancia: Math.round(base.toles.knee  * mult), peso: base.pesos.knee  },
        hip:   { label: 'Quadril',  ideal: base.ideais.hip,   tolerancia: Math.round(base.toles.hip   * mult), peso: base.pesos.hip   },
      },
    };
  });
  return niveis;
}

// ---------------------------------------------------------------------------
// Gabarito — uma imagem por golpe+fase, escolhida para representar
// fielmente o momento biomecânico
// ---------------------------------------------------------------------------

const BASE_IMG = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

const BASES: GolpeBase[] = [
  {
    label: 'Saque — Preparação (Troféu)', grupo: 'Saque', fase: 'Preparação',
    imageUrl:    BASE_IMG + 'Nadal_intense_serve_%2827042955685%29.jpg',
    imageCredit: 'Rafael Nadal — posição de troféu (Wikimedia Commons)',
    ideais: { elbow: 90,  knee: 115, hip: 155 },
    toles:  { elbow: 30,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.2, knee: 1.0, hip: 0.8 },
  },
  {
    label: 'Saque — Contato (Impacto)', grupo: 'Saque', fase: 'Contato',
    imageUrl:    BASE_IMG + 'Djokovic_trophy_pose_on_serve_%282%29_%287861310456%29.jpg',
    imageCredit: 'Novak Djokovic — impacto do saque (Wikimedia Commons)',
    ideais: { elbow: 155, knee: 160, hip: 160 },
    toles:  { elbow: 20,  knee: 20,  hip: 15  },
    pesos:  { elbow: 1.2, knee: 0.8, hip: 1.0 },
  },
  {
    label: 'Forehand — Preparação', grupo: 'Forehand', fase: 'Preparação',
    imageUrl:    BASE_IMG + 'Carlos_Alcaraz_-_Wimbledon_Final_2023.jpg',
    imageCredit: 'Carlos Alcaraz — preparação do forehand (Wikimedia Commons)',
    ideais: { elbow: 120, knee: 140, hip: 140 },
    toles:  { elbow: 25,  knee: 25,  hip: 25  },
    pesos:  { elbow: 1.0, knee: 0.9, hip: 1.1 },
  },
  {
    label: 'Forehand — Contato', grupo: 'Forehand', fase: 'Contato',
    imageUrl:    BASE_IMG + 'Carlos_Alcaraz_-_Roland_Garros_2025_-_serving_%28cropped%29.jpg',
    imageCredit: 'Carlos Alcaraz — contato do forehand (Wikimedia Commons)',
    ideais: { elbow: 148, knee: 140, hip: 150 },
    toles:  { elbow: 22,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
  {
    label: 'Backhand — Preparação', grupo: 'Backhand', fase: 'Preparação',
    imageUrl:    BASE_IMG + 'Roger_Federer_at_the_US_Open_2011_backhand.jpg',
    imageCredit: 'Roger Federer — preparação do backhand (Wikimedia Commons)',
    ideais: { elbow: 100, knee: 135, hip: 135 },
    toles:  { elbow: 25,  knee: 25,  hip: 25  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  {
    label: 'Backhand — Contato', grupo: 'Backhand', fase: 'Contato',
    imageUrl:    BASE_IMG + 'Novak_Djokovic_Backhand_%287313627914%29.jpg',
    imageCredit: 'Novak Djokovic — contato do backhand (Wikimedia Commons)',
    ideais: { elbow: 150, knee: 135, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  {
    label: 'Slice — Preparação', grupo: 'Slice', fase: 'Preparação',
    imageUrl:    BASE_IMG + 'Federer_Slice_Backhand_return_-_crop_%2827042964215%29.jpg',
    imageCredit: 'Roger Federer — preparação do slice (Wikimedia Commons)',
    ideais: { elbow: 100, knee: 140, hip: 150 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  {
    label: 'Slice — Contato', grupo: 'Slice', fase: 'Contato',
    imageUrl:    BASE_IMG + 'Federer_Slice_Backhand_return_-_crop_%2827042964215%29.jpg',
    imageCredit: 'Roger Federer — contato do slice (Wikimedia Commons)',
    ideais: { elbow: 135, knee: 130, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  {
    label: 'Volley — Preparação', grupo: 'Volley', fase: 'Preparação',
    imageUrl:    BASE_IMG + 'Tim_Henman_backhand_volley_Wimbledon_2004.jpg',
    imageCredit: 'Tim Henman — preparação para volley (Wikimedia Commons)',
    ideais: { elbow: 90,  knee: 130, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
  {
    label: 'Volley — Contato', grupo: 'Volley', fase: 'Contato',
    imageUrl:    BASE_IMG + 'Nicolas_Mahut_volley_RG_2012.jpg',
    imageCredit: 'Nicolas Mahut — contato do volley (Wikimedia Commons)',
    ideais: { elbow: 145, knee: 140, hip: 155 },
    toles:  { elbow: 20,  knee: 20,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
];

// Chaves derivadas do label (ex: "Saque — Preparação (Troféu)" → "saque_preparacao")
const KEYS = [
  'saque_preparacao',
  'saque_contato',
  'forehand_preparacao',
  'forehand_contato',
  'backhand_preparacao',
  'backhand_contato',
  'slice_preparacao',
  'slice_contato',
  'volley_preparacao',
  'volley_contato',
];

const GABARITO: Record<string, GabaritoEntry> = {};
BASES.forEach((base, i) => {
  GABARITO[KEYS[i]] = {
    label:       base.label,
    grupo:       base.grupo,
    fase:        base.fase,
    imageUrl:    base.imageUrl,
    imageCredit: base.imageCredit,
    niveis:      makeNiveis(base),
  };
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  res.json(GABARITO);
});

router.get('/:golpeFaseId', (req, res) => {
  const { golpeFaseId } = req.params;
  const entry = GABARITO[golpeFaseId];
  if (!entry) {
    return res.status(404).json({ error: 'Golpe+fase não encontrado', golpeFaseId });
  }
  res.json(entry);
});

router.get('/:golpeFaseId/:nivel', (req, res) => {
  const { golpeFaseId, nivel } = req.params;
  const entry = GABARITO[golpeFaseId];
  if (!entry) return res.status(404).json({ error: 'Golpe+fase não encontrado' });
  const config = entry.niveis[nivel as NivelAluno];
  if (!config) return res.status(404).json({ error: 'Nível não encontrado' });
  res.json(config);
});

export { router as gabaritoRouter };
