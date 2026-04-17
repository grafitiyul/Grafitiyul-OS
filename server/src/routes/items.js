import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// ---------- Content items ----------

router.get('/content', async (_req, res) => {
  const items = await prisma.contentItem.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json(items);
});

router.get('/content/:id', async (req, res) => {
  const item = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

router.post('/content', async (req, res) => {
  const { title, body = '', internalNote = null } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const item = await prisma.contentItem.create({ data: { title, body, internalNote } });
  res.status(201).json(item);
});

router.put('/content/:id', async (req, res) => {
  const { title, body, internalNote } = req.body;
  const item = await prisma.contentItem.update({
    where: { id: req.params.id },
    data: { title, body, internalNote },
  });
  res.json(item);
});

router.delete('/content/:id', async (req, res) => {
  try {
    await prisma.contentItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: 'Cannot delete — item is used in a flow.' });
  }
});

// ---------- Question items ----------

router.get('/questions', async (_req, res) => {
  const items = await prisma.questionItem.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json(items);
});

router.get('/questions/:id', async (req, res) => {
  const item = await prisma.questionItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

router.post('/questions', async (req, res) => {
  const { title, questionText = '', answerType, options = [], internalNote = null } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!['open_text', 'single_choice'].includes(answerType)) {
    return res.status(400).json({ error: 'invalid answerType' });
  }
  const item = await prisma.questionItem.create({
    data: { title, questionText, answerType, options, internalNote },
  });
  res.status(201).json(item);
});

router.put('/questions/:id', async (req, res) => {
  const { title, questionText, answerType, options, internalNote } = req.body;
  const item = await prisma.questionItem.update({
    where: { id: req.params.id },
    data: { title, questionText, answerType, options, internalNote },
  });
  res.json(item);
});

router.delete('/questions/:id', async (req, res) => {
  try {
    await prisma.questionItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: 'Cannot delete — item is used in a flow.' });
  }
});

export default router;
