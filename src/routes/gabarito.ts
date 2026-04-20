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

const GABARITO: Record<string, GabaritoGolpe> = {
  saque_trofeu: {
    label: 'Saque — Posição de Troféu',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/37/Andy_Roddick_wsh07.jpg',
    imageCredit: 'Andy Roddick (CC BY 2.0 – Boss Tweed)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 100, tolerancia: 30, peso: 1.2 },
      knee:  { label: 'Joelho',   ideal: 120, tolerancia: 25, peso: 1.0 },
      hip:   { label: 'Quadril',  ideal: 160, tolerancia: 20, peso: 0.8 },
    },
  },
  saque_impacto: {
    label: 'Saque — Impacto',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e2/Murray_serve_part_2.jpg',
    imageCredit: 'Andy Murray (CC BY 2.0 – Nick Hewson)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 175, tolerancia: 20, peso: 1.2 },
      knee:  { label: 'Joelho',   ideal: 165, tolerancia: 20, peso: 0.8 },
      hip:   { label: 'Quadril',  ideal: 172, tolerancia: 15, peso: 1.0 },
    },
  },
  forehand_contato: {
    label: 'Forehand — Contato',
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/56/Andrea_Petkovic%27s_forehand.jpg",
    imageCredit: 'Andrea Petkovic (CC BY-SA 3.0)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 165, tolerancia: 25, peso: 1.0 },
      knee:  { label: 'Joelho',   ideal: 145, tolerancia: 25, peso: 1.0 },
      hip:   { label: 'Quadril',  ideal: 155, tolerancia: 20, peso: 1.0 },
    },
  },
  backhand_contato: {
    label: 'Backhand — Contato',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/2009_Australian_Open_-_Ana_Ivanovic_03.jpg',
    imageCredit: 'Ana Ivanovic (CC BY 2.0 – Richard Fisher)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 155, tolerancia: 25, peso: 1.1 },
      knee:  { label: 'Joelho',   ideal: 140, tolerancia: 25, peso: 0.9 },
      hip:   { label: 'Quadril',  ideal: 150, tolerancia: 20, peso: 1.0 },
    },
  },
  slice_contato: {
    label: 'Slice — Contato',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Federer_Slice_Backhand_return_-_crop_%2827042964215%29.jpg',
    imageCredit: 'Roger Federer (CC BY-SA 2.0 – JC/Tennis-Bargains.com)',
    metas: {
      elbow: { label: 'Cotovelo', ideal: 140, tolerancia: 25, peso: 1.1 },
      knee:  { label: 'Joelho',   ideal: 135, tolerancia: 25, peso: 0.9 },
      hip:   { label: 'Quadril',  ideal: 150, tolerancia: 20, peso: 1.0 },
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
