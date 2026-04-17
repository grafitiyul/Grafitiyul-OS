import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'grafitiyul-os-server',
    timestamp: new Date().toISOString(),
  });
});

// Serve the built React client.
app.use(express.static(clientDist));

// SPA fallback: any unmatched GET returns index.html so client-side routing works.
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`[grafitiyul-os-server] listening on port ${port}`);
});
