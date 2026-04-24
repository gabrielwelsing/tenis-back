// =============================================================================
// JOGOS ROUTER — Mural de Treinos (disponibilidade compartilhada)
// =============================================================================

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /jogos?cidade=xxx — retorna jogos não expirados da cidade
router.get('/', async (req, res) => {
  const cidade = (req.query.cidade as string | undefined)?.trim();
  const hoje   = new Date().toISOString().split('T')[0];

  const jogos = await prisma.jogo.findMany({
    where: {
      ...(cidade ? { cidade: { equals: cidade, mode: 'insensitive' } } : {}),
      // Mantém jogos cuja dataFim (ou dataInicio) é hoje ou no futuro
      OR: [
        { dataFim:    { gte: hoje } },
        { dataFim:    null, dataInicio: { gte: hoje } },
      ],
    },
    orderBy: { publicadoEm: 'desc' },
  });

  res.json(jogos.map(j => ({ ...j, publicadoEm: Number(j.publicadoEm) })));
});

// POST /jogos — publica disponibilidade
router.post('/', async (req, res) => {
  const { id, cidade, classe, dataInicio, dataFim, horarioInicio, horarioFim, local, whatsapp, publicadoEm, emailPublicador } = req.body;

  if (!id || !cidade || !classe || !dataInicio || !horarioInicio || !horarioFim || !local || !whatsapp || !publicadoEm) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  }

  const jogo = await prisma.jogo.create({
    data: {
      id, cidade, classe, dataInicio,
      dataFim:         dataFim   ?? null,
      horarioInicio, horarioFim, local, whatsapp,
      publicadoEm:     BigInt(publicadoEm),
      emailPublicador: emailPublicador ?? null,
    },
  });

  res.status(201).json({ ...jogo, publicadoEm: Number(jogo.publicadoEm) });
});

// DELETE /jogos/:id — remove publicação (apenas o próprio publicador)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { emailPublicador } = req.body;

  const jogo = await prisma.jogo.findUnique({ where: { id } });
  if (!jogo) return res.status(404).json({ error: 'Publicação não encontrada.' });
  if (emailPublicador && jogo.emailPublicador && jogo.emailPublicador !== emailPublicador) {
    return res.status(403).json({ error: 'Sem permissão para remover esta publicação.' });
  }

  await prisma.jogo.delete({ where: { id } });
  res.json({ ok: true });
});

export { router as jogosRouter };
