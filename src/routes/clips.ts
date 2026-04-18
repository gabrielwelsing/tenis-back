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

// POST /clips/audio — vincula áudio ao vídeo
// Se videoId for enviado → vincula direto (lógica correta e determinística)
// Se não for enviado → fallback por timestamp mais próximo
router.post('/audio', async (req, res) => {
  const { timestamp, audioDurationMs, driveAudioUrl, videoId } = req.body;

  if (!timestamp || !driveAudioUrl) {
    return res.status(400).json({ error: 'Campos obrigatórios: timestamp, driveAudioUrl.' });
  }

  // ── Caso 1: videoId explícito — vincula direto, sem adivinhação ───────────
  if (videoId) {
    const clip = await prisma.clip.findUnique({ where: { id: videoId } });

    if (!clip) {
      return res.status(404).json({ error: `Vídeo ${videoId} não encontrado.` });
    }

    const updated = await prisma.clip.update({
      where: { id: videoId },
      data:  { driveAudioUrl, audioDurationMs: audioDurationMs ?? null },
    });

    return res.json({ ...updated, timestamp: updated.timestamp.toString() });
  }

  // ── Caso 2: fallback — busca o vídeo mais recente sem áudio ───────────────
  const clips = await prisma.clip.findMany({
    where:   { driveAudioUrl: null },
    orderBy: { timestamp: 'desc' },
    take:    1,
  });

  if (clips.length === 0) {
    return res.status(404).json({ error: 'Nenhum vídeo sem áudio encontrado.' });
  }

  const updated = await prisma.clip.update({
    where: { id: clips[0].id },
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
