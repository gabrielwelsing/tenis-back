// =============================================================================
// GABARITO — Referências biomecânicas por golpe de tênis
// Imagens: Wikimedia Commons (CC BY 2.0 / CC BY-SA 2.0 / CC BY-SA 3.0)
// =============================================================================

import { Router } from 'express';

const router = Router();

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface JointMeta {
  label: string;
  ideal: number;       // ângulo ideal em graus
  tolerancia: number;  // desvio máximo em graus para score = 0%
  peso: number;        // fator de importância na média ponderada (score geral)
}

interface GabaritoGolpe {
  label: string;
  imageUrl: string;
  imageCredit: string;
  metas: {
    elbow: JointMeta;
    knee: JointMeta;
    hip: JointMeta;
  };
}

// ---------------------------------------------------------------------------
// Biblioteca de referências
// ---------------------------------------------------------------------------

// Ângulos calibrados para vista LATERAL (plano sagital) — câmera posicionada
// perpendicular à linha de base. Valores baseados em biomecânica do tênis.
// As imagens de referência devem idealmente ser fotos laterais dos atletas.
const GABARITO: Record<string, GabaritoGolpe> = {
  saque_trofeu: {
    label: 'Saque — Posição de Troféu',
    // Vista lateral: braço da raquete dobrado atrás da cabeça, joelhos fletidos carregando energia
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/37/Andy_Roddick_wsh07.jpg',
    imageCredit: 'Andy Roddick (CC BY 2.0 – Boss Tweed)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 90,  tolerancia: 30, peso: 1.2 }, // ~90° na vista lateral: raquete atrás da cabeça
      knee:  { label: 'Joelho',   ideal: 115, tolerancia: 25, peso: 1.0 }, // ~115° agachado carregando
      hip:   { label: 'Quadril',  ideal: 155, tolerancia: 20, peso: 0.8 }, // ~155° leve arqueamento dorsal
    },
  },
  saque_impacto: {
    label: 'Saque — Impacto',
    // Vista lateral: braço quase totalmente estendido para cima, pernas estendendo
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e2/Murray_serve_part_2.jpg',
    imageCredit: 'Andy Murray (CC BY 2.0 – Nick Hewson)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 170, tolerancia: 20, peso: 1.2 }, // quase estendido
      knee:  { label: 'Joelho',   ideal: 160, tolerancia: 20, peso: 0.8 }, // extensão das pernas
      hip:   { label: 'Quadril',  ideal: 168, tolerancia: 15, peso: 1.0 }, // rotação/extensão completa
    },
  },
  forehand_contato: {
    label: 'Forehand — Contato',
    // Vista lateral (câmera atrás da linha de fundo): quadril rotacionado, cotovelo levemente flexionado
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/56/Andrea_Petkovic%27s_forehand.jpg",
    imageCredit: 'Andrea Petkovic (CC BY-SA 3.0)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 160, tolerancia: 25, peso: 1.0 }, // levemente flexionado no contato
      knee:  { label: 'Joelho',   ideal: 140, tolerancia: 25, peso: 1.0 }, // base atlética estável
      hip:   { label: 'Quadril',  ideal: 150, tolerancia: 20, peso: 1.0 }, // rotação do tronco completada
    },
  },
  backhand_contato: {
    label: 'Backhand — Contato',
    // Vista lateral: braço de bater cruzado à frente, joelhos dobrados para baixa bola
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/2009_Australian_Open_-_Ana_Ivanovic_03.jpg',
    imageCredit: 'Ana Ivanovic (CC BY 2.0 – Richard Fisher)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 150, tolerancia: 25, peso: 1.1 }, // braço levemente fletido
      knee:  { label: 'Joelho',   ideal: 135, tolerancia: 25, peso: 0.9 }, // flexão para ajustar altura
      hip:   { label: 'Quadril',  ideal: 145, tolerancia: 20, peso: 1.0 }, // rotação oposta ao forehand
    },
  },
  slice_contato: {
    label: 'Slice — Contato',
    // Vista lateral: raquete descendo com ângulo, cotovelo mais alto que punho
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Federer_Slice_Backhand_return_-_crop_%2827042964215%29.jpg',
    imageCredit: 'Roger Federer (CC BY-SA 2.0 – JC/Tennis-Bargains.com)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 135, tolerancia: 25, peso: 1.1 }, // mais fechado para dar efeito cortado
      knee:  { label: 'Joelho',   ideal: 130, tolerancia: 25, peso: 0.9 }, // um pouco mais fletido que backhand
      hip:   { label: 'Quadril',  ideal: 145, tolerancia: 20, peso: 1.0 }, // posição semi-aberta
    },
  },
};

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// GET /gabarito — todos os golpes
router.get('/', (_req, res) => {
  res.json(GABARITO);
});

// GET /gabarito/:golpeId — golpe específico
router.get('/:golpeId', (req, res) => {
  const { golpeId } = req.params;
  const golpe = GABARITO[golpeId];
  if (!golpe) {
    return res.status(404).json({ error: 'Golpe não encontrado', golpeId });
  }
  res.json(golpe);
});

export { router as gabaritoRouter };
