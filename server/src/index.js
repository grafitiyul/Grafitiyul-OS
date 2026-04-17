import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import itemsRouter from './routes/items.js';
import flowsRouter from './routes/flows.js';
import attemptsRouter from './routes/attempts.js';
import reviewsRouter from './routes/reviews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'grafitiyul-os-server',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/items', itemsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/attempts', attemptsRouter);
app.use('/api/reviews', reviewsRouter);

app.use(express.static(clientDist));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`[grafitiyul-os-server] listening on port ${port}`);
});
