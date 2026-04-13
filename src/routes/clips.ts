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
