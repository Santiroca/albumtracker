import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.options('*', cors());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_IMAGE_MB || 12) * 1024 * 1024
  }
});

const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';

function loadValidStickerIds(){
  const dataPath = path.join(__dirname, 'data.js');
  const source = fs.readFileSync(dataPath, 'utf8');
  const ids = new Set();

  for(const match of source.matchAll(/S\(\s*['"]([^'"]+)['"]/g)){
    ids.add(String(match[1]).toUpperCase());
  }

  return ids;
}

const VALID_IDS = loadValidStickerIds();
const VALID_PREFIXES = [...new Set([...VALID_IDS].map(id => {
  const cc = id.match(/^CC\d+$/);
  if(cc) return 'CC';
  const m = id.match(/^([A-Z]{2,4})-\d+$/);
  return m ? m[1] : null;
}).filter(Boolean))].sort();

function normalizeStickerCode(value){
  let raw = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[–—_:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if(!raw) return null;

  raw = raw
    .replace(/\bFWG\b/g, 'FWC')
    .replace(/\bFVV\b/g, 'FWC')
    .replace(/\bC0\b/g, 'CC')
    .replace(/\bCO\b/g, 'CC');

  const compact = raw.replace(/[^A-Z0-9]/g, '');

  let prefix = '';
  let number = '';

  const cc = compact.match(/^CC([0-9]{1,2})$/);
  if(cc){
    prefix = 'CC';
    number = cc[1];
  }else{
    const compactRegular = compact.match(/^([A-Z]{2,4})([0-9]{1,2})$/);
    const spacedRegular = raw.match(/\b([A-Z]{2,4})\s*[- ]\s*([0-9]{1,2})\b/);
    const m = compactRegular || spacedRegular;
    if(m){
      prefix = m[1];
      number = m[2];
    }
  }

  const n = parseInt(number, 10);
  if(!prefix || !Number.isFinite(n)) return null;

  if(prefix === 'CC') return `CC${n}`;
  if(prefix === 'FWC') return `FWC-${n}`;
  return `${prefix}-${n}`;
}

function buildPrompt(){
  return `
Sos un escáner de figuritas Panini FIFA World Cup 2026.

Tarea:
- Mirá la imagen.
- Extraé únicamente los códigos ubicados arriba a la derecha de cada figurita.
- Los códigos válidos tienen este formato: TUN 14, ARG 10, FWC 3, CC 4.
- No leas ni devuelvas texto de FIFA, PANINI, copyright, nombres de jugadores, años, URLs ni números de otras zonas.
- Si una misma figurita/código aparece dos veces, devolvelo dos veces.
- Ordená de izquierda a derecha y de arriba hacia abajo.
- Si algo no se ve claro, devolvelo con confidence "low" o no lo devuelvas.
- No inventes códigos.

Prefijos válidos:
${VALID_PREFIXES.join(', ')}

Respondé solo JSON según el schema.
`;
}

function parseOpenAIJson(response){
  const text = response.output_text || '';
  if(!text) return {};
  try{
    return JSON.parse(text);
  }catch(_){
    const match = text.match(/\{[\s\S]*\}/);
    if(match) return JSON.parse(match[0]);
    return {};
  }
}

app.post('/api/scan-stickers', upload.single('image'), async (req, res) => {
  try{
    if(!process.env.OPENAI_API_KEY){
      return res.status(500).json({
        error: 'Falta configurar OPENAI_API_KEY en el backend.'
      });
    }

    if(!req.file){
      return res.status(400).json({ error: 'No recibí ninguna imagen.' });
    }

    if(!/^image\//.test(req.file.mimetype || '')){
      return res.status(400).json({ error: 'El archivo tiene que ser una imagen.' });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const base64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${base64}`;

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildPrompt() },
            { type: 'input_image', image_url: imageUrl }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sticker_scan_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              codes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    code: { type: 'string' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    note: { type: 'string' }
                  },
                  required: ['code', 'confidence', 'note']
                }
              },
              warnings: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['codes', 'warnings']
          }
        }
      }
    });

    const parsed = parseOpenAIJson(response);
    const incoming = Array.isArray(parsed.codes) ? parsed.codes : [];
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    const accepted = [];
    const rejected = [];

    for(const item of incoming.slice(0, 40)){
      const normalized = normalizeStickerCode(item.code);
      if(normalized && VALID_IDS.has(normalized)){
        accepted.push({
          id: normalized,
          code: normalized,
          confidence: item.confidence || 'medium',
          note: item.note || '',
          raw: item.code || normalized
        });
      }else if(item.code){
        rejected.push(String(item.code));
      }
    }

    res.json({
      ok: true,
      model,
      codes: accepted,
      rejected,
      warnings
    });
  }catch(err){
    console.error('scan-stickers error', err);
    res.status(500).json({
      error: 'Falló el escaneo con IA.',
      detail: process.env.NODE_ENV === 'development' ? String(err.message || err) : undefined
    });
  }
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Album Tracker listo en http://localhost:${port}`);
  console.log(`Escáner IA usando modelo: ${model}`);
});
