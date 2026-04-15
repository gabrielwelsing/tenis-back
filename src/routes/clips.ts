// =============================================================================
// CLIPS ROUTER — POST /clips e GET /clips
// =============================================================================

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// POST /clips — salva metadados de um lance recém-enviado ao Drive
router.post('/', async (req, res) => {
  const { id, timestamp, videoDurationMs, audioDurationMs, driveVideoUrl, driveAudioUrl } = req.body;

  if (!id || !timestamp || !driveVideoUrl) {
    return res.status(400).json({ error: 'Campos obrigatórios: id, timestamp, driveVideoUrl.' });
  }

  const clip = await prisma.clip.create({
    data: {
      id,
      timestamp:       BigInt(timestamp),
      videoDurationMs: videoDurationMs ?? 0,
      audioDurationMs: audioDurationMs ?? null,
      driveVideoUrl,
      driveAudioUrl:   driveAudioUrl ?? null,
      syncStatus:      'synced',
    },
  });

  return res.status(201).json({ ...clip, timestamp: clip.timestamp.toString() });
});

// POST /clips/audio — vincula áudio ao vídeo de timestamp mais próximo
router.post('/audio', async (req, res) => {
  const { timestamp, audioDurationMs, driveAudioUrl } = req.body;
  if (!timestamp || !driveAudioUrl) {
    return res.status(400).json({ error: 'Campos obrigatórios: timestamp, driveAudioUrl.' });
  }

  // Busca o clipe com timestamp mais próximo (sem áudio ainda)
  const clips = await prisma.clip.findMany({
    where: { driveAudioUrl: null },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  if (clips.length === 0) {
    return res.status(404).json({ error: 'Nenhum vídeo encontrado para vincular.' });
  }

  const ts      = BigInt(timestamp);
  const closest = clips.reduce((prev, curr) => {
    const diffPrev = prev.timestamp > ts ? prev.timestamp - ts : ts - prev.timestamp;
    const diffCurr = curr.timestamp > ts ? curr.timestamp - ts : ts - curr.timestamp;
    return diffCurr < diffPrev ? curr : prev;
  });

  const updated = await prisma.clip.update({
    where: { id: closest.id },
    data:  { driveAudioUrl, audioDurationMs: audioDurationMs ?? null },
  });

  return res.json({ ...updated, timestamp: updated.timestamp.toString() });
});

// GET /clips — retorna todos os lances, do mais recente ao mais antigo
router.get('/', async (_req, res) => {
  const clips = await prisma.clip.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const serialized = clips.map((c) => ({ ...c, timestamp: c.timestamp.toString() }));
  return res.json(serialized);
});

export { router as clipsRouter };
