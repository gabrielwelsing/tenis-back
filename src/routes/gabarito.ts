// =============================================================================
// GABARITO — Referências biomecânicas multidimensionais
// Estrutura: golpe+fase → atleta → nível → ConfigNivel
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

interface ConfigNivel {
  imageUrl: string;
  imageCredit: string;
  metas: {
    elbow: JointMeta;
    knee:  JointMeta;
    hip:   JointMeta;
  };
}

interface AtletaEntry {
  label: string;
  niveis: Record<NivelAluno, ConfigNivel>;
}

interface GabaritoEntry {
  label: string;
  grupo: string;
  fase: string;
  atletas: Record<string, AtletaEntry>;
}

// ---------------------------------------------------------------------------
// Dados base dos golpes (ângulos laterais, tolerâncias base para intermediário)
// ---------------------------------------------------------------------------

interface GolpeBase {
  label: string;
  grupo: string;
  fase:  string;
  ideais: { elbow: number; knee: number; hip: number };
  toles:  { elbow: number; knee: number; hip: number };
  pesos:  { elbow: number; knee: number; hip: number };
}

const GOLPES_BASE: Record<string, GolpeBase> = {
  saque_preparacao: {
    label: 'Saque — Preparação (Troféu)', grupo: 'Saque', fase: 'Preparação',
    // Braço de raquete dobrado atrás da cabeça, joelhos fletidos carregando energia
    ideais: { elbow: 90,  knee: 115, hip: 155 },
    toles:  { elbow: 30,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.2, knee: 1.0, hip: 0.8 },
  },
  saque_contato: {
    label: 'Saque — Contato (Impacto)', grupo: 'Saque', fase: 'Contato',
    // Braço quase totalmente estendido para cima, pernas se estendendo
    ideais: { elbow: 170, knee: 160, hip: 168 },
    toles:  { elbow: 20,  knee: 20,  hip: 15  },
    pesos:  { elbow: 1.2, knee: 0.8, hip: 1.0 },
  },
  forehand_preparacao: {
    label: 'Forehand — Preparação', grupo: 'Forehand', fase: 'Preparação',
    // Braço puxado para trás, transferência de peso para pé traseiro
    ideais: { elbow: 120, knee: 140, hip: 140 },
    toles:  { elbow: 25,  knee: 25,  hip: 25  },
    pesos:  { elbow: 1.0, knee: 0.9, hip: 1.1 },
  },
  forehand_contato: {
    label: 'Forehand — Contato', grupo: 'Forehand', fase: 'Contato',
    // Cotovelo levemente fletido, quadril rotacionado, base estável
    ideais: { elbow: 160, knee: 140, hip: 150 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
  backhand_preparacao: {
    label: 'Backhand — Preparação', grupo: 'Backhand', fase: 'Preparação',
    // Braço cruzado à frente/lateral, rotação de tronco para trás
    ideais: { elbow: 100, knee: 135, hip: 135 },
    toles:  { elbow: 25,  knee: 25,  hip: 25  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  backhand_contato: {
    label: 'Backhand — Contato', grupo: 'Backhand', fase: 'Contato',
    // Braço levemente fletido, joelhos dobrados para ajustar altura
    ideais: { elbow: 150, knee: 135, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  slice_preparacao: {
    label: 'Slice — Preparação', grupo: 'Slice', fase: 'Preparação',
    // Raquete alta, cotovelo elevado, preparação para swing descendente
    ideais: { elbow: 100, knee: 140, hip: 150 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  slice_contato: {
    label: 'Slice — Contato', grupo: 'Slice', fase: 'Contato',
    // Raquete descendo com ângulo, cotovelo mais alto que punho
    ideais: { elbow: 135, knee: 130, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.1, knee: 0.9, hip: 1.0 },
  },
  volley_preparacao: {
    label: 'Volley — Preparação', grupo: 'Volley', fase: 'Preparação',
    // Backswing compacto, split step, cotovelo flexionado
    ideais: { elbow: 90,  knee: 130, hip: 145 },
    toles:  { elbow: 25,  knee: 25,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
  volley_contato: {
    label: 'Volley — Contato', grupo: 'Volley', fase: 'Contato',
    // Movimento de punho para frente, braço quase estendido
    ideais: { elbow: 160, knee: 140, hip: 155 },
    toles:  { elbow: 20,  knee: 20,  hip: 20  },
    pesos:  { elbow: 1.0, knee: 1.0, hip: 1.0 },
  },
};

// ---------------------------------------------------------------------------
// Atletas de referência
// ---------------------------------------------------------------------------

const ATLETAS: Record<string, string> = {
  federer: 'Roger Federer',
  nadal:   'Rafael Nadal',
  djokovic: 'Novak Djokovic',
  alcaraz:  'Carlos Alcaraz',
  swiatek:  'Iga Swiatek',
  barty:    'Ashleigh Barty',
};

// Imagens por atleta × golpe+fase (preenchidas quando disponíveis)
// Formato: ATLETA_IMAGES[atletaId][golpeFaseId] = { url, credit }
const ATLETA_IMAGES: Record<string, Record<string, { url: string; credit: string }>> = {
  federer: {
    slice_contato: {
      url:    'https://upload.wikimedia.org/wikipedia/commons/a/a4/Federer_Slice_Backhand_return_-_crop_%2827042964215%29.jpg',
      credit: 'Roger Federer (CC BY-SA 2.0 – JC/Tennis-Bargains.com)',
    },
  },
  nadal: {
    saque_preparacao: {
      url:    'https://upload.wikimedia.org/wikipedia/commons/3/37/Andy_Roddick_wsh07.jpg',
      credit: 'Referência saque troféu (CC BY 2.0 – Boss Tweed)',
    },
  },
  djokovic: {
    saque_contato: {
      url:    'https://upload.wikimedia.org/wikipedia/commons/e/e2/Murray_serve_part_2.jpg',
      credit: 'Referência saque impacto (CC BY 2.0 – Nick Hewson)',
    },
  },
  alcaraz: {},
  swiatek: {
    forehand_contato: {
      url:    "https://upload.wikimedia.org/wikipedia/commons/5/56/Andrea_Petkovic%27s_forehand.jpg",
      credit: 'Referência forehand (CC BY-SA 3.0)',
    },
  },
  barty: {
    backhand_contato: {
      url:    'https://upload.wikimedia.org/wikipedia/commons/b/b6/2009_Australian_Open_-_Ana_Ivanovic_03.jpg',
      credit: 'Referência backhand (CC BY 2.0 – Richard Fisher)',
    },
  },
};

// ---------------------------------------------------------------------------
// Multiplicadores de tolerância por nível
// ---------------------------------------------------------------------------

const TOLE_MULT: Record<NivelAluno, number> = {
  iniciante:     2.0,
  intermediario: 1.0,
  avancado:      0.4,
};

// ---------------------------------------------------------------------------
// Helper: gera os 3 níveis para um atleta×golpe combinado
// ---------------------------------------------------------------------------

function makeNiveis(
  imageUrl: string,
  imageCredit: string,
  base: GolpeBase,
): Record<NivelAluno, ConfigNivel> {
  const niveis = {} as Record<NivelAluno, ConfigNivel>;
  (Object.keys(TOLE_MULT) as NivelAluno[]).forEach((nivel) => {
    const mult = TOLE_MULT[nivel];
    niveis[nivel] = {
      imageUrl,
      imageCredit,
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
// Construir GABARITO completo
// ---------------------------------------------------------------------------

const GABARITO: Record<string, GabaritoEntry> = {};

Object.entries(GOLPES_BASE).forEach(([golpeFaseId, base]) => {
  const atletas: Record<string, AtletaEntry> = {};
  Object.entries(ATLETAS).forEach(([atletaId, atletaLabel]) => {
    const img = ATLETA_IMAGES[atletaId]?.[golpeFaseId];
    atletas[atletaId] = {
      label:  atletaLabel,
      niveis: makeNiveis(img?.url ?? '', img?.credit ?? '', base),
    };
  });
  GABARITO[golpeFaseId] = {
    label:   base.label,
    grupo:   base.grupo,
    fase:    base.fase,
    atletas,
  };
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// GET /gabarito — estrutura completa
router.get('/', (_req, res) => {
  res.json(GABARITO);
});

// GET /gabarito/:golpeFaseId — golpe+fase específico
router.get('/:golpeFaseId', (req, res) => {
  const { golpeFaseId } = req.params;
  const entry = GABARITO[golpeFaseId];
  if (!entry) {
    return res.status(404).json({ error: 'Golpe+fase não encontrado', golpeFaseId });
  }
  res.json(entry);
});

// GET /gabarito/:golpeFaseId/:atletaId/:nivel
router.get('/:golpeFaseId/:atletaId/:nivel', (req, res) => {
  const { golpeFaseId, atletaId, nivel } = req.params;
  const entry = GABARITO[golpeFaseId];
  if (!entry) return res.status(404).json({ error: 'Golpe+fase não encontrado' });
  const atleta = entry.atletas[atletaId];
  if (!atleta) return res.status(404).json({ error: 'Atleta não encontrado' });
  const config = atleta.niveis[nivel as NivelAluno];
  if (!config) return res.status(404).json({ error: 'Nível não encontrado' });
  res.json(config);
});

export { router as gabaritoRouter };
