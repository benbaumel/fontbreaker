import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from "axios";
import AdmZip from "adm-zip";
import { Font } from "fonteditor-core";
import * as wawoff2 from "wawoff2";
import zlib from "zlib";
import * as cheerio from 'cheerio';
import * as csstree from 'css-tree';
import cors from 'cors';
import multer from 'multer';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// ESM shims
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set pdfjs worker source for Node.js
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
console.log(`[PDF] Worker path: ${workerPath}`);

import * as opentype from 'opentype.js';

// Helper for parallel execution with concurrency limit
// Helper for parallel execution with concurrency limit
const pLimit = (limit: number) => {
  const queue: any[] = [];
  let active = 0;

  const next = () => {
    active--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };

  return (fn: () => Promise<any>) => {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve).catch(reject).finally(next);
      };

      if (active < limit) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
};

// --- Font Repair Utilities ---

const validateFont = (d: Buffer): boolean => {
  try {
    const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    const f = opentype.parse(ab);
    return f.numGlyphs > 0;
  } catch (e) {
    return false;
  }
};

const isVariableFont = (d: Buffer): boolean => {
  try {
    return d.indexOf(Buffer.from('fvar')) !== -1;
  } catch (e) {
    return false;
  }
};

const cleanFamilyName = (f: string): string => {
  if (!f) return '';
  return f.replace(/['"]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase
    .replace(/_/g, ' ')
    .replace(/\b(hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|italic|oblique|webfont|woff2?|ttf|otf|eot|svg|variable|vf|it|bd|md|bk|rg|demi|semi|extra|ultra|hollow|outline|stencil|inline|shadow|fill|soft|rounded|ml|v\d+|aaa|v\.\d+|v|v\d+\.\d+|v\d+-\d+)\b/gi, '')
    .replace(/(?<=^|[\s\-_])(קל|רגיל|בינוני|חצי שמן|שמן|שמן מאוד|שחור|נטוי|צר|רחב|פונטביט|אאא)(?=$|[\s\-_])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[-\s]+$/g, '')
    .replace(/^[-\s]+/g, '')
    .trim();
};

const getSubFamilyName = (weight: string, style: string): string => {
  const weights: Record<string, string> = {
    '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
    '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black'
  };
  const w = weights[weight] || 'Regular';
  const s = style && style !== 'normal' ? style.charAt(0).toUpperCase() + style.slice(1) : '';
  if (w === 'Regular' && s) return s;
  if (w === 'Regular' && !s) return 'Regular';
  return s ? `${w} ${s}` : w;
};

const rebuildWithFontEditor = (d: Buffer, inputType: string, targetType: string = 'ttf', fontFamily: string = 'FontBreaker', weight: string = '400', style: string = 'normal', forceClean: boolean = false): Buffer | null => {
  try {
    let fontObj: any = null;
    const tryTypes = [inputType, 'ttf', 'woff', 'woff2', 'otf', 'eot'];
    for (const t of tryTypes) {
      try {
        fontObj = Font.create(d, { type: t as any, hinting: true });
        if (fontObj.get().glyf && fontObj.get().glyf.length > 0) break;
      } catch (err) {}
    }
    
    if (!fontObj) return null;
    const ttf = fontObj.get() as any;
    if (!ttf.glyf || ttf.glyf.length === 0) return null;
    
    const cleanName = (s: any) => (typeof s === 'string' ? s.replace(/[^\x00-\x7F\u0590-\u05FF]/g, '').trim() : '');
    let rawFamily = cleanName(ttf.name?.fontFamily) || cleanName(fontFamily) || 'FontBreaker';
    let family = cleanFamilyName(rawFamily);
    let subFamily = getSubFamilyName(weight, style);
    
    if (!family || family.length < 2) family = rawFamily || 'FontBreaker';
    const psName = family.replace(/[^a-zA-Z0-9-]/g, '') || 'FontBreaker';
    const fullName = `${family} ${subFamily}`;
    const uniqueId = `${family}-${subFamily}-${weight}`;

    ttf.name = [
      { nameID: 1, platformID: 3, encodingID: 1, languageID: 1033, nameString: family },
      { nameID: 2, platformID: 3, encodingID: 1, languageID: 1033, nameString: subFamily },
      { nameID: 3, platformID: 3, encodingID: 1, languageID: 1033, nameString: uniqueId },
      { nameID: 4, platformID: 3, encodingID: 1, languageID: 1033, nameString: fullName },
      { nameID: 6, platformID: 3, encodingID: 1, languageID: 1033, nameString: `${psName.replace(/-+$/, '')}-${subFamily.replace(/\s+/g, '')}` },
      { nameID: 1, platformID: 1, encodingID: 0, languageID: 0, nameString: family },
      { nameID: 2, platformID: 1, encodingID: 0, languageID: 0, nameString: subFamily },
      { nameID: 4, platformID: 1, encodingID: 0, languageID: 0, nameString: fullName },
      { nameID: 6, platformID: 1, encodingID: 0, languageID: 0, nameString: `${psName.replace(/-+$/, '')}-${subFamily.replace(/\s+/g, '')}` }
    ];

    if (!ttf.head || forceClean) {
      ttf.head = {
        version: 1, fontRevision: 1, checkSumAdjustment: 0, magicNumber: 0x5F0F3CF5,
        flags: 0x0003, unitsPerEm: ttf.head?.unitsPerEm || (targetType === 'ttf' ? 2048 : 1000), 
        created: ttf.head?.created || Date.now(),
        modified: Date.now(), xMin: ttf.head?.xMin || 0, yMin: ttf.head?.yMin || -200,
        xMax: ttf.head?.xMax || 1000, yMax: ttf.head?.yMax || 1000, macStyle: 0,
        lowestRecPPEM: 8, fontDirectionHint: 2, glyphDataFormat: 0
      };
      // Do NOT force indexToLocFormat: 0, as it breaks fonts with >64k glyph data (Short Offset)
      // fonteditor-core will choose correctly if we don't force it.
    }

    if (!ttf.hhea || forceClean) {
      const defaultAscent = targetType === 'ttf' ? 1800 : 1000;
      const defaultDescent = targetType === 'ttf' ? -400 : -200;
      ttf.hhea = {
        version: 1, ascent: ttf.hhea?.ascent || defaultAscent, descent: ttf.hhea?.descent || defaultDescent,
        lineGap: ttf.hhea?.lineGap || 0, advanceWidthMax: ttf.hhea?.advanceWidthMax || 1000,
        minLeftSideBearing: ttf.hhea?.minLeftSideBearing || 0, minRightSideBearing: ttf.hhea?.minRightSideBearing || 0,
        xMaxExtent: ttf.hhea?.xMaxExtent || 1000, caretSlopeRise: 1, caretSlopeRun: 0,
        caretOffset: 0, reserved1: 0, reserved2: 0, reserved3: 0, reserved4: 0,
        metricDataFormat: 0, numOfLongHorMetrics: ttf.glyf ? ttf.glyf.length : 0
      };
    }

    if (!ttf.maxp || forceClean) {
      ttf.maxp = {
        version: 1.0, numGlyphs: ttf.glyf ? ttf.glyf.length : 0, maxPoints: 1000,
        maxContours: 100, maxCompositePoints: 1000, maxCompositeContours: 100,
        maxZones: 2, maxTwilightPoints: 16, maxStorage: 64, maxFunctionDefs: 64,
        maxInstructionDefs: 64, maxStackElements: 256, maxSizeOfInstructions: 256,
        maxComponentElements: 16, maxComponentDepth: 4
      };
    }

    if (!ttf['OS/2'] || forceClean) {
      ttf['OS/2'] = {
        version: 4, xAvgCharWidth: 500, usWeightClass: 400, usWidthClass: 5, fsType: 0,
        sTypoAscender: ttf.hhea?.ascent || 800, sTypoDescender: ttf.hhea?.descent || -200,
        sTypoLineGap: 90, usWinAscent: ttf.hhea?.ascent || 1000, usWinDescent: Math.abs(ttf.hhea?.descent || 200),
        ulUnicodeRange1: 0x00000001 | 0x00000020, ulCodePageRange1: 0x00000001 | 0x00000020,
        sxHeight: 500, sCapHeight: 700, usDefaultChar: 0, usBreakChar: 32, usMaxContext: 1,
        ...(ttf['OS/2'] || {})
      };
    }

    if (!ttf.post || forceClean) {
      ttf.post = {
        format: 2, italicAngle: 0, underlinePosition: -75, underlineThickness: 50,
        isFixedPitch: 0, minMemType42: 0, maxMemType42: 0, minMemType1: 0, maxMemType1: 0,
        ...(ttf.post || {})
      };
    }

    fontObj.set(ttf);
    const out = fontObj.write({ 
      type: targetType as any, 
      hinting: targetType === 'ttf', // Enable hinting for TTF to prevent "broken" rendering
      compound2simple: true // Flattens composite glyphs for better compatibility
    });
    return out ? Buffer.from(out as any) : null;
  } catch (e: any) {
    return null;
  }
};

const rebuildWithOpenType = (d: Buffer, fontFamily: string = 'FontBreaker', weight: string = '400', style: string = 'normal'): Buffer | null => {
  try {
    const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    const fontParsed = opentype.parse(ab);
    if (fontParsed.tables.fvar) return null;
    
    const cleanName = (s: any) => (typeof s === 'string' ? s.replace(/[^\x00-\x7F\u0590-\u05FF]/g, '').trim() : '');
    const rawFamily = fontParsed.names.fontFamily?.en || fontParsed.names.fontFamily?.he || fontFamily;
    const family = cleanFamilyName(cleanName(rawFamily)) || 'FontBreaker';
    const subFamily = getSubFamilyName(weight, style);
    
    fontParsed.names.fontFamily = { en: family };
    fontParsed.names.fontSubfamily = { en: subFamily };
    fontParsed.names.fullName = { en: `${family} ${subFamily}` };
    const psFamily = family.replace(/[^a-zA-Z0-9-]/g, '').replace(/-+$/, '');
    fontParsed.names.postScriptName = { en: `${psFamily}-${subFamily.replace(/\s+/g, '')}` };
    const out = fontParsed.toBuffer();
    return out ? Buffer.from(out) : null;
  } catch (e: any) {
    return null;
  }
};

const bruteForceOpenTypeRepair = (d: Buffer, fontFamily: string = 'FontBreaker', weight: string = '400', style: string = 'normal'): Buffer | null => {
  try {
    const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    const oldFont = opentype.parse(ab);
    if (oldFont.tables.fvar) return null;
    const glyphs = [];
    for (let i = 0; i < oldFont.numGlyphs; i++) {
      try {
        const g = oldFont.glyphs.get(i);
        if (g) glyphs.push(g);
      } catch (e) {}
    }
    if (glyphs.length === 0) return null;
    const family = cleanFamilyName(fontFamily.replace(/[^\x00-\x7F\u0590-\u05FF]/g, '').trim()) || 'FontBreaker';
    const subFamily = getSubFamilyName(weight, style);
    const newFont = new opentype.Font({
      familyName: family,
      styleName: subFamily,
      unitsPerEm: oldFont.unitsPerEm || 1000,
      ascender: oldFont.ascender || 800,
      descender: oldFont.descender || -200,
      glyphs: glyphs
    });
    const out = newFont.toBuffer();
    return out ? Buffer.from(out) : null;
  } catch (e: any) {
    return null;
  }
};

const processFontSuperAggressively = async (data: Buffer, hintedType: string, fontFamily: string = 'FontBreaker', weight: string = '400', style: string = 'normal'): Promise<{ buffer: Buffer, ext: string }> => {
  const reportLogs: string[] = [];
  const candidates: { buffer: Buffer, type: string, note: string }[] = [
    { buffer: data, type: hintedType, note: 'original' }
  ];

  const signatures = [
    { sig: Buffer.from([0x77, 0x4F, 0x46, 0x32]), type: 'woff2' },
    { sig: Buffer.from([0x77, 0x4F, 0x46, 0x46]), type: 'woff' },
    { sig: Buffer.from([0x00, 0x01, 0x00, 0x00]), type: 'ttf' },
    { sig: Buffer.from([0x4F, 0x54, 0x54, 0x4F]), type: 'otf' },
    { sig: Buffer.from([0x45, 0x4F, 0x54]), type: 'eot' },
  ];

  for (const s of signatures) {
    let lastIdx = -1;
    while (true) {
      const idx = data.indexOf(s.sig, lastIdx + 1);
      if (idx === -1 || idx > 4096) break;
      if (idx > 0) candidates.push({ buffer: data.slice(idx), type: s.type, note: `trimmed ${idx} bytes to ${s.type}` });
      lastIdx = idx;
      if (s.type !== 'ttf') break;
    }
  }

  const isOTF = (buf: Buffer) => buf.slice(0, 4).toString() === 'OTTO';

  for (const cand of candidates) {
    let currentData = cand.buffer;
    let currentType = cand.type;
    const magic = currentData.slice(0, 4).toString();
    if (magic === 'wOF2' || currentType === 'woff2') {
      try {
        const decompressed = await wawoff2.decompress(currentData);
        currentData = Buffer.from(decompressed);
        currentType = isOTF(currentData) ? 'otf' : 'ttf';
      } catch (e) {}
    }

    if (isVariableFont(currentData)) return { buffer: currentData, ext: isOTF(currentData) ? 'otf' : 'ttf' };

    if (validateFont(currentData)) {
      const touched = rebuildWithOpenType(currentData, fontFamily, weight, style);
      if (touched && validateFont(touched)) return { buffer: touched, ext: isOTF(touched) ? 'otf' : 'ttf' };
      return { buffer: currentData, ext: isOTF(currentData) ? 'otf' : 'ttf' };
    }

    // Try OTF repair first (User preference)
    let result = rebuildWithFontEditor(currentData, currentType, 'otf', fontFamily, weight, style);
    if (result && validateFont(result)) return { buffer: result, ext: 'otf' };

    result = rebuildWithOpenType(currentData, fontFamily, weight, style);
    if (result && validateFont(result)) return { buffer: result, ext: isOTF(result) ? 'otf' : 'ttf' };

    result = rebuildWithFontEditor(currentData, currentType, 'ttf', fontFamily, weight, style);
    if (result && validateFont(result)) return { buffer: result, ext: 'ttf' };

    result = bruteForceOpenTypeRepair(currentData, fontFamily, weight, style);
    if (result && validateFont(result)) return { buffer: result, ext: 'ttf' };
  }

  const types = ['ttf', 'otf', 'woff', 'eot'];
  for (const t of types) {
    for (const cand of candidates) {
      // Try OTF first
      let result = rebuildWithFontEditor(cand.buffer, t, 'otf', fontFamily, weight, style);
      if (result && validateFont(result)) return { buffer: result, ext: 'otf' };
      
      result = rebuildWithFontEditor(cand.buffer, t, 'ttf', fontFamily, weight, style);
      if (result && validateFont(result)) return { buffer: result, ext: 'ttf' };
    }
  }

  const getFinalExt = async (buf: Buffer, hint: string) => {
    if (isOTF(buf)) return 'otf';
    const magic = buf.slice(0, 4).toString();
    if (magic === 'wOF2') {
      try {
        const d = await wawoff2.decompress(buf);
        return isOTF(Buffer.from(d)) ? 'otf' : 'ttf';
      } catch (e) {}
    }
    if (magic === 'wOFF') return 'ttf';
    if (hint === 'woff2' || hint === 'woff' || hint === 'ttf') return 'ttf';
    if (hint === 'opentype') return 'otf';
    return hint || 'ttf';
  };

  const finalExt = await getFinalExt(data, hintedType);
  return { buffer: data, ext: finalExt };
};

// --- End Font Repair Utilities ---

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const router = express.Router();

// API Routes
router.get("/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// Font Proxy to bypass CORS for previews
router.get("/proxy-font", async (req, res) => {
  const { url, referer } = req.query;
  if (!url || typeof url !== "string") return res.status(400).send("URL is required");

  try {
    if (!url || url.length < 10) return res.status(400).send("Invalid URL");

    // If it's clearly not a font URL, don't even try
    const lowerUrl = url.toLowerCase();
    if (!lowerUrl.includes('.woff') && !lowerUrl.includes('.ttf') && 
        !lowerUrl.includes('.otf') && !lowerUrl.includes('.eot') && !lowerUrl.includes('.svg')) {
      return res.status(400).send("Not a font URL");
    }

    if (url.startsWith("data:")) {
      const parts = url.split(",");
      const mime = parts[0].match(/:(.*?);/)?.[1] || "font/woff2";
      const buffer = Buffer.from(parts[1], "base64");
      res.set("Content-Type", mime);
      res.set("Access-Control-Allow-Origin", "*");
      return res.send(buffer);
    }

    const urlObj = new URL(url);
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        // We "pretend" to be a normal browser on their site
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": (typeof referer === 'string' ? referer : urlObj.origin),
        "Origin": urlObj.origin,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "font",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site"
      },
      timeout: 10000
    });
    
    // Tell your site this is a font file
    res.set("Content-Type", response.headers["content-type"] || "font/woff2");
    res.set("Access-Control-Allow-Origin", "*"); // This allows YOUR site to see it
    res.send(Buffer.from(response.data));
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      // Silent 404 for the console, but tell the frontend
      return res.status(404).send("Font not found");
    }
    console.error(`Proxy error for ${url}: ${error.message}`);
    res.status(500).send("Extraction failed");
  }
});

const extractFontsFromPdf = async (pdfUrl: string) => {
  const fonts: any[] = [];
  console.log(`[PDF] Starting extraction for: ${pdfUrl}`);
  try {
    const urlObj = new URL(pdfUrl);
    const response = await axios.get(pdfUrl, { 
      responseType: 'arraybuffer',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/pdf,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": urlObj.origin,
        "Origin": urlObj.origin,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
      timeout: 30000,
      maxContentLength: 100 * 1024 * 1024
    });
    
    const contentType = response.headers['content-type'] || '';
    console.log(`[PDF] Downloaded ${response.data.byteLength} bytes. Content-Type: ${contentType}`);
    
    if (contentType.includes('text/html')) {
      console.error("[PDF] Error: Received HTML instead of PDF. Possible firewall or 404.");
      return [];
    }

    const data = new Uint8Array(response.data);
    const loadingTask = pdfjs.getDocument({ 
      data,
      disableFontFace: true,
      verbosity: 0
    });
    const pdf = await loadingTask.promise;
    console.log(`[PDF] Document loaded, pages: ${pdf.numPages}`);
    
    const fontFamilies = new Set<string>();
    const OPS = (pdfjs as any).OPS || {};
    
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`[PDF] Scanning page ${i}...`);
      const page = await pdf.getPage(i);
      
      // Get both common and page-specific objects
      const commonObjs = await page.commonObjs;
      const objs = await page.objs;
      
      const opList = await page.getOperatorList() as any;
      if (!opList) {
        console.log(`[PDF] Page ${i} has no operator list.`);
        continue;
      }
      
      console.log(`[PDF] Page ${i} dependencies: ${opList.dependencies?.length || 0}`);
      
      // Use dependencies which is a more direct way to find fonts
      if (opList.dependencies) {
        for (const fontId of opList.dependencies) {
          // Try to get from commonObjs first, then page-specific objs
          let font = await commonObjs.get(fontId);
          if (!font) font = await objs.get(fontId);
          
          if (font && font.name && !fontFamilies.has(font.name)) {
            console.log(`[PDF] Found font via dependency: ${font.name} (Embedded: ${!!font.data})`);
            fontFamilies.add(font.name);
            
            let fontUrl = "";
            let isEmbedded = false;
            let format = 'unknown';
            
            if (font.data) {
              const base64 = Buffer.from(font.data).toString('base64');
              fontUrl = `data:font/opentype;base64,${base64}`;
              isEmbedded = true;
              format = 'otf';
            } else {
              console.log(`[PDF] Font ${font.name} is not embedded, skipping.`);
              continue;
            }
            
            fonts.push({
              family: font.name.replace(/^[A-Z]{6}\+/, ''),
              url: fontUrl,
              weight: "400",
              style: "normal",
              isPdfFont: true,
              isEmbedded,
              format
            });
          }
        }
      }
      
      // Fallback to operator scan if dependencies didn't yield everything
      if (opList.fnArray && opList.argsArray) {
        for (let j = 0; j < opList.fnArray.length; j++) {
          const fn = opList.fnArray[j];
          const args = opList.argsArray[j];
          
          if (fn === OPS.setFont) {
            const fontId = args[0];
            if (fontFamilies.has(fontId)) continue; // Already found via dependencies
            
            let font = await commonObjs.get(fontId);
            if (!font) font = await objs.get(fontId);
            
            if (font && font.name && !fontFamilies.has(font.name)) {
              console.log(`[PDF] Found font via setFont: ${font.name} (Embedded: ${!!font.data})`);
              fontFamilies.add(font.name);
              
              if (font.data) {
                const base64 = Buffer.from(font.data).toString('base64');
                const fontUrl = `data:font/opentype;base64,${base64}`;
                fonts.push({
                  family: font.name.replace(/^[A-Z]{6}\+/, ''),
                  url: fontUrl,
                  weight: "400",
                  style: "normal",
                  isPdfFont: true,
                  isEmbedded: true,
                  format: 'otf'
                });
              }
            }
          }
        }
      }
    }
    
    // Fallback: If no fonts found via operators, try to scan the internal objects directly if possible
    // This is harder but sometimes necessary if setFont isn't used conventionally
    if (fonts.length === 0) {
      console.log("[PDF] No fonts found via operators, checking document objects...");
      // Some PDF structures might store fonts differently
    }
    
  } catch (error: any) {
    console.error(`[PDF] Extraction Error for ${pdfUrl}:`, error.message);
  }
  console.log(`[PDF] Finished. Found ${fonts.length} fonts.`);
  return fonts;
};

const resolveUrl = (fontUrl: string, baseUrl: string) => {
  if (!fontUrl) return "";
  
  // Clean up the URL: remove quotes and any trailing garbage accidentally captured
  let cleanUrl = fontUrl.trim()
    .replace(/^['"]|['"]$/g, "") // Remove surrounding quotes
    .split(/[;{}<>]/)[0]         // Stop at CSS/HTML delimiters
    .trim();

  // If it's a JS-like string (contains commas, assignments, or multiple dots in weird places)
  // we need to be careful. But font URLs can have query params.
  // Let's look for common JS patterns that indicate a malformed extraction.
  if (cleanUrl.includes(",") && (cleanUrl.includes("=") || cleanUrl.includes("("))) {
    // Likely JS code, try to extract just the part that looks like a URL
    const urlMatch = cleanUrl.match(/[^, "']+\.(?:woff2?|ttf|otf|eot|svg)(?:\?[^, "']*)?/i);
    if (urlMatch) {
      cleanUrl = urlMatch[0];
    } else {
      return "";
    }
  }

  if (!cleanUrl || cleanUrl.length < 3) return "";
  
  // If it contains "src:" or "font-style:" it's definitely malformed CSS extraction
  const lower = cleanUrl.toLowerCase();
  if (lower.includes("src:") || 
      lower.includes("font-style:") ||
      lower.includes("font-weight:") ||
      lower.includes("url(") ||
      lower.includes("display:") ||
      lower.includes("padding:") ||
      lower.includes("margin:")) {
    return "";
  }

  if (cleanUrl.startsWith("data:")) return cleanUrl;
  if (cleanUrl.startsWith("//")) return "https:" + cleanUrl;
  if (cleanUrl.startsWith("http")) return cleanUrl;
  
  try {
    const url = new URL(cleanUrl, baseUrl);
    // Final check: does it end with a known font extension?
    const path = url.pathname.toLowerCase();
    const isFontExtension = path.endsWith('.woff2') || path.endsWith('.woff') || path.endsWith('.ttf') || 
                           path.endsWith('.otf') || path.endsWith('.eot') || path.endsWith('.svg');
    const isFontQuery = url.search.toLowerCase().includes('.woff') || url.search.toLowerCase().includes('.ttf') ||
                        url.search.toLowerCase().includes('.otf') || url.search.toLowerCase().includes('.woff2');
    const isFontKeyword = path.includes('font') || url.search.toLowerCase().includes('font') || 
                          url.href.toLowerCase().includes('alefalefalef');

    if (!isFontExtension && !isFontQuery && !isFontKeyword) {
      return "";
    }
    return url.href;
  } catch (e) {
    return "";
  }
};

const extractFontsFromCss = (css: string, baseUrl: string) => {
  const fonts: any[] = [];
  try {
    const ast = csstree.parse(css);
    csstree.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name === 'font-face' && node.block) {
          let family = 'Unknown Font';
          let weight = '400';
          let style = 'normal';
          const urls: string[] = [];

          csstree.walk(node.block, {
            visit: 'Declaration',
            enter(decl) {
              const prop = decl.property.toLowerCase();
              if (prop === 'font-family') {
                family = csstree.generate(decl.value).replace(/['"]/g, '').trim();
              } else if (prop === 'font-weight') {
                weight = csstree.generate(decl.value).trim();
              } else if (prop === 'font-style') {
                style = csstree.generate(decl.value).trim();
              } else if (prop === 'src') {
                csstree.walk(decl.value, {
                  visit: 'Url',
                  enter(urlNode) {
                    const urlValue = urlNode.value;
                    if (typeof urlValue === 'string') {
                      urls.push(resolveUrl(urlValue, baseUrl));
                    } else if (urlValue && (urlValue as any).value) {
                      urls.push(resolveUrl((urlValue as any).value, baseUrl));
                    }
                  }
                });
              }
            }
          });

          urls.forEach(url => {
            if (url) {
              fonts.push({ family, url, weight, style });
            }
          });
        }
      }
    });
  } catch (e) {
    // Fallback regex if css-tree fails
    const fontFaceRegex = /@font-face\s*\{([\s\S]*?)\}/gi;
    let match;
    while ((match = fontFaceRegex.exec(css)) !== null) {
      const content = match[1];
      const familyMatch = content.match(/font-family\s*:\s*([^;!]+)/i);
      const srcMatch = content.match(/src\s*:\s*([^;!]+)/i);
      if (familyMatch && srcMatch) {
        const family = familyMatch[1].replace(/['"]/g, "").trim();
        const weightMatch = content.match(/font-weight\s*:\s*([^;!]+)/i);
        const styleMatch = content.match(/font-style\s*:\s*([^;!]+)/i);
        const weight = weightMatch ? weightMatch[1].trim() : "400";
        const style = styleMatch ? styleMatch[1].trim() : "normal";
        
        // Improved URL extraction: non-greedy and avoids picking up nested url() or CSS props
        const urlMatches = srcMatch[1].match(/url\s*\(\s*['"]?([^'")]*?)['"]?\s*\)/gi);
        if (urlMatches) {
          urlMatches.forEach(uMatch => {
            const fontUrl = uMatch.replace(/url\s*\(\s*['"]?|['"]?\s*\)/gi, "").trim();
            const resolved = resolveUrl(fontUrl, baseUrl);
            if (resolved) {
              fonts.push({ family, url: resolved, weight, style });
            }
          });
        }
      }
    }
  }
  return fonts;
};

const weightKeywords: Record<string, string> = {
  'extra-bold': '800', 'extrabold': '800', 'ultra-bold': '800', 'ultrabold': '800', 'שמן מאוד': '800',
  'semi-bold': '600', 'semibold': '600', 'demi-bold': '600', 'demibold': '600', 'חצי שמן': '600',
  'extra-light': '200', 'extralight': '200', 'ultra-light': '200', 'ultralight': '200', 
  'thin': '100', 'hairline': '100', 
  'light': '300', 'קל': '300',
  'book': '400', 'regular': '400', 'normal': '400', 'רגיל': '400',
  'medium': '500', 'בינוני': '500',
  'bold': '700', 'שמן': '700',
  'black': '900', 'heavy': '900', 'fat': '900', 'poster': '900', 'שחור': '900',
  'stencil': '400',
};

const styleKeywords = [
  'italic', 'oblique', 'hollow', 'outline', 'stencil', 'inline', 'shadow', 'fill', 'soft', 'rounded', 'brutalist', 'display', 'condensed', 'expanded', 'נטוי', 'צר', 'רחב', 'פונטביט', 'אאא'
];

const extractWeight = (name: string) => {
  const lower = name.toLowerCase();
  
  // Look for numeric weight anywhere (100-950)
  // Match things like 400, 450, 500, etc.
  const numericMatch = lower.match(/\b([1-9][0-9][05])\b/);
  if (numericMatch) {
    const val = parseInt(numericMatch[1]);
    if (val >= 100 && val <= 950) return val.toString();
  }

  // Look for generic 3-digit weight
  const match = lower.match(/\b([1-9]00)\b/);
  if (match) return match[1];
  
  // Look for keywords
  for (const [key, val] of Object.entries(weightKeywords)) {
    if (lower.includes(key)) return val;
  }
  return null;
};

const normalizeFamily = (f: string, fUrl?: string) => {
  let urlName = "";
  if (fUrl) {
    const fileName = fUrl.split('/').pop()?.split(/[?#]/)[0].split('.')[0] || '';
    if (fileName && fileName.length > 2) {
      let parts = fileName.split(/[-_]/);
      let nameParts = parts.filter(p => !/^(fb|mf|aaa|g|regular|bold|italic|medium|light|thin|black|woff2?|ttf|otf|eot|svg|variable|vf|it|bd|md|bk|rg|demi|semi|extra|ultra|hairline|extralight|ultralight|book|semibold|demibold|extrabold|ultrabold|heavy|fat|poster|oblique|webfont|ml|v\d+|aaa|v\.\d+|v)$/i.test(p));
      urlName = nameParts.join(' ').replace(/([A-Z])/g, ' $1').trim();
      urlName = urlName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }

  if (!f || f === "Unknown Font" || f === "Discovered Font" || f === "Preloaded Font") {
    return urlName || f || "Unknown Font";
  }
  
  // Remove common weight/style keywords but keep sub-family names like "Brutalist", "Display", "Condensed", etc.
  let clean = f.replace(/['"]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase
    .replace(/_/g, ' ')
    .replace(/\b(fb|mf|aaa|g|hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|italic|oblique|webfont|woff2?|ttf|otf|eot|svg|variable|vf|it|bd|md|bk|rg|demi|semi|extra|ultra|ml|v\d+|aaa|v\.\d+|v|v\d+\.\d+|v\d+-\d+)\b/gi, '')
    .replace(/(?<=^|[\s\-_])(קל|רגיל|בינוני|חצי שמן|שמן|שמן מאוד|שחור|נטוי|צר|רחב|פונטביט|אאא)(?=$|[\s\-_])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[-\s]+$/g, '')
    .replace(/^[-\s]+/g, '')
    .trim();

  if (clean.toLowerCase().includes("font style") || clean.toLowerCase().includes("myfont")) {
    clean = clean.replace(/\d+$/, '').replace(/(font style|myfont)/gi, '').trim();
  }
  
  // Title Case
  clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  
  return clean || urlName || f.trim() || "Unknown Font";
};

const normalizeWeight = (w: string, family: string, fUrl: string) => {
  let weight = w.toString().toLowerCase().trim();
  const filename = fUrl.split('/').pop() || '';
  const fromUrl = extractWeight(filename);
  if (fromUrl) return fromUrl;
  if (weight === 'normal' || weight === '400') {
    const fromFamily = extractWeight(family);
    if (fromFamily) return fromFamily;
  }
  if (weight === 'normal') return '400';
  if (weight === 'bold') return '700';
  if (weight === 'lighter') return '300';
  if (weight === 'bolder') return '800';
  const numeric = parseInt(weight);
  if (!isNaN(numeric) && numeric >= 100 && numeric <= 900) return numeric.toString();
  return '400';
};

// Helper to get real metadata from font binary
const getRealFontMetadataFromBuffer = async (buffer: Buffer) => {
  if (buffer.length < 100) return null;

  // Decompress WOFF2 if needed
  if (buffer.slice(0, 4).toString() === 'wOF2') {
    try {
      const decompressed = await wawoff2.decompress(buffer);
      buffer = Buffer.from(decompressed);
    } catch (e) {
      // If decompression fails, we might still be able to parse if it's not actually woff2
    }
  }

  try {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const font = opentype.parse(ab);
    
    // 1. Extract Family Name
    // Prefer Typographic Family (16) over Font Family (1) over Full Name (4)
    const preferredFamily = font.names.preferredFamily?.en || font.names.preferredFamily?.he || Object.values(font.names.preferredFamily || {})[0];
    const fontFamily = font.names.fontFamily?.en || font.names.fontFamily?.he || Object.values(font.names.fontFamily || {})[0];
    const fullName = font.names.fullName?.en || font.names.fullName?.he || Object.values(font.names.fullName || {})[0];
    const family = preferredFamily || fontFamily || fullName || null;

    // 2. Extract Subfamily Name
    // Prefer Typographic Subfamily (17) over WWS Subfamily (22) over Font Subfamily (2)
    const preferredSubfamily = font.names.preferredSubfamily?.en || font.names.preferredSubfamily?.he || Object.values(font.names.preferredSubfamily || {})[0];
    const wwsSubfamily = font.names.wwsSubfamily?.en || font.names.wwsSubfamily?.he || Object.values(font.names.wwsSubfamily || {})[0];
    const fontSubfamily = font.names.fontSubfamily?.en || font.names.fontSubfamily?.he || Object.values(font.names.fontSubfamily || {})[0];
    let subfamily = preferredSubfamily || wwsSubfamily || fontSubfamily || "";
    let subLower = subfamily.toLowerCase();

    // 3. Extract Weight
    let weight = font.tables.os2?.usWeightClass?.toString() || null;
    
    // If weight is missing or default (400), try to infer from subfamily string
    if (!weight || weight === "400") {
      if (subLower.includes('thin') || subLower.includes('hairline')) weight = "100";
      else if (subLower.includes('extralight') || subLower.includes('extra light') || subLower.includes('ultralight')) weight = "200";
      else if (subLower.includes('light')) weight = "300";
      else if (subLower.includes('medium')) weight = "500";
      else if (subLower.includes('extrabold') || subLower.includes('extra bold') || subLower.includes('ultrabold')) weight = "800";
      else if (subLower.includes('semibold') || subLower.includes('semi bold') || subLower.includes('demibold')) weight = "600";
      else if (subLower.includes('bold')) weight = "700";
      else if (subLower.includes('black') || subLower.includes('heavy') || subLower.includes('poster')) weight = "900";
      else if (subLower.includes('stencil')) weight = "400"; // Categorize stencil
    }
    
    // Check macStyle bold bit (bit 0)
    if (font.tables.head && (font.tables.head.macStyle & 1)) {
      if (!weight || parseInt(weight) < 700) weight = "700";
    }

    // 4. Extract Style (Italic/Oblique)
    let isItalic = false;
    let isOblique = false;
    
    // Check OS/2 fsSelection
    if (font.tables.os2) {
      if (font.tables.os2.fsSelection & 1) isItalic = true; // Bit 0: ITALIC
      if (font.tables.os2.fsSelection & 512) isOblique = true; // Bit 9: OBLIQUE
    }
    
    // Check head macStyle (bit 1: Italic)
    if (font.tables.head && (font.tables.head.macStyle & 2)) isItalic = true;
    
    // Check post italicAngle
    if (font.tables.post && font.tables.post.italicAngle !== 0) isItalic = true;
    
    // Check subfamily string
    if (subLower.includes('italic')) isItalic = true;
    if (subLower.includes('oblique')) isOblique = true;
    
    const style = isItalic ? 'italic' : (isOblique ? 'oblique' : 'normal');

    // Refine Subfamily Name based on weight and style if it's generic
    if (subLower === 'regular' || subLower === 'normal' || subLower === '') {
      const weightNames: Record<string, string> = {
        '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
        '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black'
      };
      let wName = weightNames[weight || '400'] || 'Regular';
      if (subLower.includes('stencil')) wName = 'Stencil';
      subfamily = style === 'normal' ? wName : (wName === 'Regular' ? 'Italic' : `${wName} Italic`);
    }

    // Extract Variable Font Metadata
    let axes: any[] = [];
    let instances: any[] = [];
    let isVariable = false;

    const getName = (nameID: number) => {
      const records = font.tables.name?.records;
      if (!records) return `ID ${nameID}`;
      
      // Try to find English record first (languageID 1033)
      const enRecord = records.find((r: any) => r.nameID === nameID && (r.languageID === 1033 || r.languageID === 0));
      if (enRecord) return enRecord.nameString || `ID ${nameID}`;
      
      // Fallback to any record with this nameID
      const anyRecord = records.find((r: any) => r.nameID === nameID);
      return anyRecord ? anyRecord.nameString : `ID ${nameID}`;
    };

    if (font.tables.fvar) {
      isVariable = true;
      const fvar = font.tables.fvar;
      if (fvar.axes) {
        axes = fvar.axes.map((axis: any) => ({
          tag: axis.tag,
          minValue: axis.minValue,
          defaultValue: axis.defaultValue,
          maxValue: axis.maxValue,
          name: getName(axis.nameID) || axis.tag
        }));
      }
      if (fvar.instances) {
        instances = fvar.instances.map((instance: any) => ({
          name: getName(instance.nameID),
          coordinates: instance.coordinates
        }));
      }
    }

    return { 
      family: typeof family === 'string' ? family : null, 
      subfamily: typeof subfamily === 'string' ? subfamily : null,
      weight: weight || "400", 
      style,
      isVariable,
      axes,
      instances
    };
  } catch (e) {
    // Fallback to fonteditor-core for WOFF or corrupted files
    try {
      let fontObj: any = null;
      const tryTypes = ['ttf', 'woff', 'woff2', 'otf', 'eot'];
      for (const t of tryTypes) {
        try {
          fontObj = Font.create(buffer, { type: t as any, hinting: false });
          if (fontObj.get().name) break;
        } catch (err) {}
      }

      if (!fontObj) return null;
      const ttf = fontObj.get() as any;
      if (!ttf || !ttf.name) return null;

      const family = ttf.name.preferredFamily || ttf.name.fontFamily || ttf.name.fullName || null;
      const subfamilyRaw = ttf.name.preferredSubfamily || ttf.name.wwsSubfamily || ttf.name.fontSubfamily || "";
      const subLower = subfamilyRaw.toLowerCase();

      let weight = ttf['OS/2']?.usWeightClass?.toString() || null;
      if (!weight || weight === "400") {
        if (subLower.includes('thin') || subLower.includes('hairline')) weight = "100";
        else if (subLower.includes('extralight') || subLower.includes('extra light') || subLower.includes('ultralight')) weight = "200";
        else if (subLower.includes('light')) weight = "300";
        else if (subLower.includes('medium')) weight = "500";
        else if (subLower.includes('extrabold') || subLower.includes('extra bold') || subLower.includes('ultrabold')) weight = "800";
        else if (subLower.includes('semibold') || subLower.includes('semi bold') || subLower.includes('demibold')) weight = "600";
        else if (subLower.includes('bold')) weight = "700";
        else if (subLower.includes('black') || subLower.includes('heavy')) weight = "900";
        else if (subLower.includes('stencil')) weight = "400";
      }

      const isItalic = (ttf.post?.italicAngle !== 0 || subLower.includes('italic') || (ttf.head?.macStyle & 2));
      const isOblique = subLower.includes('oblique');
      const style = isItalic ? 'italic' : (isOblique ? 'oblique' : 'normal');

      let subfamily = subfamilyRaw;
      if (subLower === 'regular' || subLower === 'normal' || subLower === '') {
        const weightNames: Record<string, string> = {
          '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
          '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black'
        };
        let wName = weightNames[weight || '400'] || 'Regular';
        if (subLower.includes('stencil')) wName = 'Stencil';
        subfamily = style === 'normal' ? wName : (wName === 'Regular' ? 'Italic' : `${wName} Italic`);
      }

      return {
        family: typeof family === 'string' ? family : null,
        weight: weight || "400",
        style,
        subfamily,
        isVariable: false,
        axes: [],
        instances: []
      };
    } catch (e2) {
      return null;
    }
  }
};

// Helper to get real metadata from font binary
const getRealFontMetadata = async (fontUrl: string, referer: string) => {
  if (!fontUrl || fontUrl.length < 10) return null;
  
  try {
    let buffer: Buffer;
    if (fontUrl.startsWith("data:")) {
      const parts = fontUrl.split(",");
      buffer = Buffer.from(parts[1], "base64");
    } else {
      const urlObj = new URL(fontUrl);
      const response = await axios.get(fontUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": referer || urlObj.origin,
          "Accept": "*/*"
        },
        timeout: 10000
      });
      buffer = Buffer.from(response.data);
    }

    return getRealFontMetadataFromBuffer(buffer);
  } catch (e) {
    return null;
  }
};

router.post("/upload-fonts", (req, res, next) => {
  upload.array('fonts')(req, res, (err) => {
    if (err) {
      console.error("Multer Error:", err);
      return res.status(400).json({ error: "שגיאה בהעלאת הקבצים: " + err.message });
    }
    next();
  });
}, async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.status(400).json({ error: "לא העליתם קבצים" });

  const fontGroups: Record<string, any[]> = {};

  for (const file of files) {
    try {
      let buffer = file.buffer;
      let ext = file.originalname.split('.').pop()?.toLowerCase() || 'otf';
      
      // Repair uploaded font for better preview compatibility
      const weight = extractWeight(file.originalname) || '400';
      const style = file.originalname.toLowerCase().includes('italic') ? 'italic' : 'normal';
      const repairResult = await processFontSuperAggressively(buffer, ext, file.originalname.split('.')[0], weight, style);
      buffer = repairResult.buffer;
      const finalExt = repairResult.ext;

      const metadata = await getRealFontMetadataFromBuffer(buffer);
      
      if (metadata) {
        const family = metadata.family || file.originalname.split('.')[0];
        const variation = {
          family,
          url: `data:font/${finalExt === 'otf' ? 'otf' : 'ttf'};base64,${buffer.toString('base64')}`,
          format: finalExt,
          weight: metadata.weight || '400',
          style: metadata.style || 'normal',
          isVariable: metadata.isVariable,
          axes: metadata.axes,
          instances: metadata.instances,
          originalName: file.originalname
        };

        if (!fontGroups[family]) fontGroups[family] = [];
        fontGroups[family].push(variation);
      }
    } catch (e) {
      console.error(`Error processing uploaded font ${file.originalname}:`, e);
    }
  }

  const result = Object.entries(fontGroups).map(([family, variations]) => ({
    family,
    variations
  }));

  res.json({ fonts: result });
});

router.post("/scan", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  console.log(`Scanning URL: ${url} (Aggressive Mode)`);
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": url,
        "Origin": new URL(url).origin,
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400 // Throw on 4xx/5xx
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const baseUrl = url;
    const fontData: any[] = [];

    // Detect WordPress
    const isWordPress = html.includes('wp-content') || html.includes('wp-includes') || html.includes('wp-json');
    
    // Detect AlefAlefAlef
    const isAlef = url.includes('alefalefalef.co.il');
    
    // Detect PDF
    if (url.toLowerCase().endsWith('.pdf')) {
      console.log("PDF detected, extracting fonts from document...");
      const pdfFonts = await extractFontsFromPdf(url);
      
      // Normalize PDF fonts
      const finalPdfFonts: Record<string, any[]> = {};
      for (const f of pdfFonts) {
        const cleanFamily = normalizeFamily(f.family, f.url);
        if (!finalPdfFonts[cleanFamily]) finalPdfFonts[cleanFamily] = [];
        finalPdfFonts[cleanFamily].push({
          ...f,
          family: cleanFamily,
          format: f.format || 'otf'
        });
      }
      
      // Try to resolve metadata for PDF fonts
      const families = Object.keys(finalPdfFonts);
      const resolvedPdfFonts: Record<string, any[]> = {};
      await Promise.all(families.map(async (family) => {
        const variations = finalPdfFonts[family];
        const firstVar = variations[0];
        try {
          const meta = await getRealFontMetadata(firstVar.url, url);
          const realFamily = meta && meta.family ? normalizeFamily(meta.family, firstVar.url) : family;
          const targetFamily = (realFamily && realFamily.length > 2) ? realFamily : family;
          
          if (!resolvedPdfFonts[targetFamily]) resolvedPdfFonts[targetFamily] = [];
          variations.forEach(v => {
            resolvedPdfFonts[targetFamily].push({
              ...v,
              family: targetFamily,
              weight: meta?.weight || v.weight,
              style: meta?.style || v.style,
              isVariable: meta?.isVariable,
              axes: meta?.axes,
              instances: meta?.instances
            });
          });
        } catch (e) {
          if (!resolvedPdfFonts[family]) resolvedPdfFonts[family] = [];
          resolvedPdfFonts[family].push(...variations);
        }
      }));

      const result = Object.keys(resolvedPdfFonts).map(family => ({
        family,
        variations: resolvedPdfFonts[family]
      }));

      return res.json({ fonts: result });
    }

    if (isWordPress || isAlef) {
      console.log(`${isAlef ? 'AlefAlefAlef' : 'WordPress'} detected, applying specialized scanning...`);
      // Proactively try to find fonts in common WP locations
      const wpFontPaths = [
        '/wp-content/uploads/fonts/',
        '/wp-content/uploads/elementor/custom-fonts/',
        '/wp-content/themes/',
        '/wp-content/plugins/',
        '/wp-content/uploads/sites/',
        '/wp-content/uploads/ffonts/',
        '/assets/fonts/',
        '/static/fonts/'
      ];
      
      // Look for any mention of these paths in the HTML
      wpFontPaths.forEach(path => {
        const regex = new RegExp(`['"]([^'"]*${path}[^'"]*\\.(?:woff2?|ttf|otf|eot|svg)[^'"]*)['"]`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
          fontData.push({ family: "Discovered Font", url: resolveUrl(match[1], baseUrl), weight: "400", style: "normal", isDiscovered: true });
        }
      });

      if (isAlef) {
        // AlefAlefAlef specific: look for any URL containing "anomalia" or other font names
        const alefRegex = /['"]([^'"]*alefalefalef\.co\.il[^'"]*\.(?:woff2?|ttf|otf|eot|svg)[^'"]*)['"]/gi;
        let aMatch;
        while ((aMatch = alefRegex.exec(html)) !== null) {
          fontData.push({ family: "Discovered Font", url: resolveUrl(aMatch[1], baseUrl), weight: "400", style: "normal", isDiscovered: true });
        }
      }
    }

    // 1. Parse inline <style> tags
    $('style').each((_, el) => {
      const css = $(el).text();
      fontData.push(...extractFontsFromCss(css, baseUrl));
    });

    // 2. Brute force search for fonts in the entire HTML (User's aggressive logic)
    // This finds fonts mentioned in JS, data attributes, or malformed CSS
    const fontUrlRegex = /url\(["']?([^"']+\.(?:woff2|woff|ttf|otf)(?:\?[^"']*)?)["']?\)/gi;
    let htmlMatch;
    while ((htmlMatch = fontUrlRegex.exec(html)) !== null) {
      const fUrl = resolveUrl(htmlMatch[1], baseUrl);
      if (fUrl) {
        fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
      }
    }

    // Also look for direct links to font files in HTML quotes
    const directFontRegex = /['"]([^'"]*\.(?:woff2|woff|ttf|otf)(?:\?[^'"]*)?)['"]/gi;
    while ((htmlMatch = directFontRegex.exec(html)) !== null) {
      const fUrl = resolveUrl(htmlMatch[1], baseUrl);
      if (fUrl) {
        fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
      }
    }

    // 3. Parse external <link rel="stylesheet"> and brute force search for CSS links
    const stylesheetUrls = new Set<string>();
    const scriptUrls = new Set<string>();
    
    $('link[rel="stylesheet"], link[rel="preload"][as="style"], link[rel="prefetch"][as="style"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) stylesheetUrls.add(resolveUrl(href, baseUrl));
    });

    // Brute force search for CSS files in HTML (User's logic)
    const cssRegex = /<link [^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi;
    while ((htmlMatch = cssRegex.exec(html)) !== null) {
      stylesheetUrls.add(resolveUrl(htmlMatch[1], baseUrl));
    }

    // Extra aggressive CSS discovery in strings
    const aggressiveCssRegex = /['"]([^'"]+\.css(?:\?[^"']*)?)['"]/gi;
    while ((htmlMatch = aggressiveCssRegex.exec(html)) !== null) {
      stylesheetUrls.add(resolveUrl(htmlMatch[1], baseUrl));
    }

    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) scriptUrls.add(resolveUrl(src, baseUrl));
    });

    // Fetch and parse external CSS with @import support
    const processedSsUrls = new Set<string>();
    let ssQueue = Array.from(stylesheetUrls);
    let processedCount = 0;
    const MAX_SS = 200; // Always aggressive
    const ssLimit = pLimit(15); // Process 15 stylesheets at a time

    while (ssQueue.length > 0 && processedCount < MAX_SS) {
      const currentBatch = ssQueue.splice(0, ssQueue.length);
      const nextBatch: string[] = [];

      await Promise.all(currentBatch.map(ssUrl => ssLimit(async () => {
        if (processedSsUrls.has(ssUrl)) return;
        processedSsUrls.add(ssUrl);
        processedCount++;

        try {
          if (ssUrl.includes('fonts.googleapis.com/css') && !ssUrl.includes('family=')) {
            return; // Skip broken Google Fonts URLs
          }
          if (ssUrl.includes('fonts.googleapis.com/css?family=') && ssUrl.endsWith('family=')) {
            return; // Skip empty family Google Fonts URLs
          }

          const ssResponse = await axios.get(ssUrl, { 
            timeout: 10000,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            }
          });
          const css = ssResponse.data;
          if (typeof css === 'string') {
            const extracted = extractFontsFromCss(css, ssUrl);
            fontData.push(...extracted);
            
            // Deep scan for font URLs and Base64
            const broadRegex = /(?:url\s*\(\s*['"]?|['"]|[:=]\s*['"])(data:(?:application|font)\/(?:x-font-woff|font-woff2|font-truetype|font-opentype|octet-stream|woff2?|ttf|otf);base64,[a-zA-Z0-9+/=]+|[^'")]*\.(woff2?|ttf|otf|eot|svg)(?:\?.*)?)(?:['"]?|['"]\s*\)?)/gi;
            let match;
            while ((match = broadRegex.exec(css)) !== null) {
              const fUrl = match[1].startsWith('data:') ? match[1] : resolveUrl(match[1], ssUrl);
              fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
            }

            // Find @imports recursively
            const importRegex = /@import\s+(?:url\s*\(\s*['"]?|['"])([^'")]*)(?:['"]?|['"]\s*\);?)/gi;
            let iMatch;
            while ((iMatch = importRegex.exec(css)) !== null) {
              const importedUrl = resolveUrl(iMatch[1], ssUrl);
              if (!processedSsUrls.has(importedUrl)) {
                nextBatch.push(importedUrl);
              }
            }
          }
        } catch (e) {
          console.log(`Failed to fetch stylesheet: ${ssUrl}`);
        }
      })));

      ssQueue.push(...nextBatch);
    }

    // 2.5 Scan external scripts and JSON for font URLs and Base64
    const MAX_RESOURCES = 300; // Always aggressive
    const resourceUrls = new Set([...scriptUrls]);
    
    // Also look for potential JSON config files and common font assets
    $('a[href$=".json"], link[href$=".json"], script[type="application/json"]').each((_, el) => {
      const href = $(el).attr('href') || $(el).attr('src');
      if (href) resourceUrls.add(resolveUrl(href, baseUrl));
    });

    // Proactively try common font manifest locations
    const commonManifests = ['/fonts.json', '/assets/fonts.json', '/theme.json', '/config.json', '/manifest.json'];
    commonManifests.forEach(m => resourceUrls.add(resolveUrl(m, baseUrl)));

    const resourceList = Array.from(resourceUrls).slice(0, MAX_RESOURCES);
    const resourceLimit = pLimit(25); // Process 25 resources at a time

    await Promise.all(resourceList.map(rUrl => resourceLimit(async () => {
      try {
        const rResponse = await axios.get(rUrl, { 
          timeout: 10000,
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": baseUrl
          }
        });
        const content = rResponse.data;
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        
        if (contentStr) {
          // 1. Look for font-family/name in JS/JSON
          const familyRegex = /(?:font[-]?family|family|name|title)\s*[:=]\s*['"]([^'"]+)['"]/gi;
          let fMatch;
          while ((fMatch = familyRegex.exec(contentStr)) !== null) {
             const family = fMatch[1];
             if (family.length < 3 || family.includes('/') || family.includes('.')) continue;

             // Look for a URL within 1000 characters (wider window for JSON objects)
             const start = Math.max(0, fMatch.index - 500);
             const end = Math.min(contentStr.length, fMatch.index + 1000);
             const snippet = contentStr.substring(start, end);
             const urlMatch = snippet.match(/(?:url|src|file|path)\s*[:=]?\s*(?:url\s*\(\s*['"]?|['"])(data:[^'")]*|[^'")]*\.(woff2?|ttf|otf|eot|svg)(?:\?.*)?)(?:['"]?|['"]\s*\)?)/i);
             
             if (urlMatch) {
               fontData.push({ family, url: resolveUrl(urlMatch[1], rUrl), weight: "400", style: "normal" });
             }
          }

          // 2. Broad regex for font URLs and Base64 - more permissive on MIME types
          const broadRegex = /(?:url\s*\(\s*['"]?|['"]|[:=]\s*['"]|src\s*[:=]\s*['"])(data:[^'")]*;base64,[a-zA-Z0-9+/=]+|[^'")]*\.(woff2?|ttf|otf|eot|svg)(?:\?.*)?)(?:['"]?|['"]\s*\)?)/gi;
          let match;
          while ((match = broadRegex.exec(contentStr)) !== null) {
            const fUrl = match[1].startsWith('data:') ? match[1] : resolveUrl(match[1], rUrl);
            fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
          }

          // 3. Ultra-broad regex for anything that looks like a font path in strings
          const ultraBroadRegex = /['"]([^'"]+\.(?:woff2?|ttf|otf|eot|svg)(?:\?.*)?)['"]/gi;
          let ubMatch;
          while ((ubMatch = ultraBroadRegex.exec(contentStr)) !== null) {
            const potentialUrl = ubMatch[1];
            if (potentialUrl.length < 200) { // Avoid matching massive strings
              const fUrl = resolveUrl(potentialUrl, rUrl);
              fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
            }
          }
        }
      } catch (e) {
        // Silently skip failed resources
      }
    })));

    // 3. Check for preload/prefetch links
    $('link[rel="preload"][as="font"], link[rel="prefetch"][as="font"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        fontData.push({ family: "Preloaded Font", url: resolveUrl(href, baseUrl), weight: "400", style: "normal", isPreload: true });
      }
    });

    // 4. Fallback: Search for font-like URLs in HTML (including relative paths)
    const broadFontRegex = /(?:url\s*\(\s*['"]?|['"]|src\s*[:=]\s*['"]|[:=]\s*['"])(data:(?:application|font)\/(?:x-font-woff|font-woff2|font-truetype|font-opentype|octet-stream|woff2?|ttf|otf);base64,[a-zA-Z0-9+/=]+|[^'")]*\.(woff2?|ttf|otf|eot|svg)(?:\?.*)?)(?:['"]?|['"]\s*\)?)/gi;
    while ((htmlMatch = broadFontRegex.exec(html)) !== null) {
      const fUrl = htmlMatch[1].startsWith('data:') ? htmlMatch[1] : resolveUrl(htmlMatch[1], baseUrl);
      // Skip common false positives
      if (fUrl.includes('google-analytics') || fUrl.includes('facebook.com')) continue;
      fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
    }

    // 4.2. Check style tags
    $('style').each((_, el) => {
      const styleContent = $(el).html();
      if (styleContent) {
        let styleMatch;
        while ((styleMatch = broadFontRegex.exec(styleContent)) !== null) {
          const fUrl = resolveUrl(styleMatch[1], baseUrl);
          if (fUrl.includes('google-analytics') || fUrl.includes('facebook.com')) continue;
          fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
        }
      }
    });

    // 4.5. Extra check for scripts and attributes
    $('[data-font], [data-family], [data-font-family]').each((_, el) => {
      const family = $(el).attr('data-font') || $(el).attr('data-family') || $(el).attr('data-font-family');
      const urlAttr = $(el).attr('data-url') || $(el).attr('data-src');
      if (family && urlAttr) {
        fontData.push({ family, url: resolveUrl(urlAttr, baseUrl), weight: "400", style: "normal" });
      }
    });

    $('script').each((_, el) => {
      const scriptContent = $(el).html();
      if (scriptContent) {
        let scriptMatch;
        while ((scriptMatch = broadFontRegex.exec(scriptContent)) !== null) {
          const fUrl = resolveUrl(scriptMatch[1], baseUrl);
          if (fUrl.includes('google-analytics') || fUrl.includes('facebook.com')) continue;
          fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
        }
      }
    });

    const finalFonts: Record<string, any[]> = {};
    const allUrls = new Set<string>();
    
    const addVariation = (family: string, fUrl: string, weight: string, style: string) => {
      const isGeneric = family === "Preloaded Font" || family === "Discovered Font";
      
      // If we already have this URL in a real family, skip the generic discovery
      if (isGeneric && allUrls.has(fUrl)) return;

      let bestFamily = family;
      const filename = (fUrl.split('/').pop() || '').split('?')[0];
      
      // Try to guess family from filename if current family is generic or suspicious
      if (family.toLowerCase().includes('font') || family.toLowerCase() === 'myfont' || family.length < 3) {
        const guessed = filename.split('.')[0]
          .replace(/[-_]/g, ' ')
          .replace(/\d+$/, '')
          .replace(/\b(hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|italic|oblique|condensed|expanded|narrow|wide|webfont|woff2?|ttf|otf|eot|svg)\b/gi, '')
          .trim();
        if (guessed && guessed.length > 2) bestFamily = guessed;
      }
      
      const cleanFamily = normalizeFamily(bestFamily, fUrl);
      
      if (!finalFonts[cleanFamily]) finalFonts[cleanFamily] = [];
      
      const normalizedWeight = normalizeWeight(weight, bestFamily, fUrl);
      const normalizedStyle = style.toLowerCase().trim(); // Use raw normalized style for storage
      const format = fUrl.split('.').pop()?.split('?')[0].toLowerCase() || 'unknown';
      
      const existingIdx = finalFonts[cleanFamily].findIndex(v => v.url === fUrl);
      if (existingIdx === -1) {
        finalFonts[cleanFamily].push({ 
          family: cleanFamily, 
          url: fUrl, 
          weight: normalizedWeight, 
          style: normalizedStyle, 
          format 
        });
        allUrls.add(fUrl);
      }
    };

    fontData.forEach(f => {
      addVariation(f.family, f.url, f.weight || "400", f.style || "normal");
    });

    // 5. ENHANCEMENT: Resolve real font names from binary metadata
    const familiesToResolve = Object.keys(finalFonts);
    const resolvedFonts: Record<string, any[]> = {};

    const metaLimit = pLimit(10);
    await Promise.all(familiesToResolve.map(async (family) => {
      const variations = finalFonts[family];
      if (!variations || variations.length === 0) return;

      // Resolve each variation individually to get its real family, weight, style and subfamily
      await Promise.all(variations.map(async (v) => {
        return metaLimit(async () => {
          try {
            const meta = await getRealFontMetadata(v.url, baseUrl);
            
            // Use the real family name found in the binary if available
            const realFamily = meta && meta.family ? normalizeFamily(meta.family, v.url) : family;
            const targetFamily = (realFamily && realFamily.length > 2) ? realFamily : family;
            
            if (!resolvedFonts[targetFamily]) resolvedFonts[targetFamily] = [];
            
            // Normalize subfamily: Trim, Title Case, and ensure it's not empty
            let sub = meta?.subfamily || v.subfamily || 'Regular';
            sub = sub.trim().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            if (sub === 'Normal') sub = 'Regular';

            const updatedVar = { 
              ...v, 
              family: targetFamily,
              subfamily: sub,
              weight: meta?.weight || v.weight,
              style: meta?.style || v.style,
              isVariable: meta?.isVariable,
              axes: meta?.axes,
              instances: meta?.instances
            };

            // Deduplicate within the target family using weight, style, and subfamily
            const existsIdx = resolvedFonts[targetFamily].findIndex(ev => 
              ev.weight === updatedVar.weight && 
              ev.style === updatedVar.style && 
              (ev.subfamily === updatedVar.subfamily || !ev.subfamily || !updatedVar.subfamily)
            );

            if (existsIdx === -1) {
              resolvedFonts[targetFamily].push(updatedVar);
            } else if (updatedVar.format === 'woff2') {
              resolvedFonts[targetFamily][existsIdx] = updatedVar;
            }
          } catch (e) {
            // If metadata fails, fall back to what we had
            if (!resolvedFonts[family]) resolvedFonts[family] = [];
            resolvedFonts[family].push(v);
          }
        });
      }));
    }));

    // 6. FUZZY GROUPING: Group families that share a long common prefix (Nuclear Option Idea 2)
    const finalResult: Record<string, any[]> = {};
    const sortedFamilies = Object.keys(resolvedFonts).sort((a, b) => b.length - a.length);
    
    const processedFamilies = new Set<string>();
    
    for (const family of sortedFamilies) {
      if (processedFamilies.has(family)) continue;
      
      let targetFamily = family;
      const variations = [...resolvedFonts[family]];
      processedFamilies.add(family);
      
      // Look for other families that share a long prefix (at least 8 chars)
      for (const otherFamily of sortedFamilies) {
        if (processedFamilies.has(otherFamily)) continue;
        
        // Check for common prefix
        let prefix = "";
        for (let i = 0; i < Math.min(family.length, otherFamily.length); i++) {
          if (family[i] === otherFamily[i]) prefix += family[i];
          else break;
        }
        
        // If they share a significant prefix, group them
        // But BE CAREFUL: don't group if one is "Condensed" and other is not, unless prefix includes "Condensed"
        const isCondensed = (f: string) => /\b(condensed|compressed|narrow|צר)\b/i.test(f);
        const isExtended = (f: string) => /\b(extended|expanded|wide|רחב)\b/i.test(f);
        const isMono = (f: string) => /\b(mono|monospace)\b/i.test(f);
        const isHollow = (f: string) => /\b(hollow|outline|stencil|inline|shadow|fill)\b/i.test(f);
        const isRounded = (f: string) => /\b(rounded|soft)\b/i.test(f);
        const isSlab = (f: string) => /\b(slab)\b/i.test(f);
        const isSans = (f: string) => /\b(sans)\b/i.test(f);
        const isSerif = (f: string) => /\b(serif)\b/i.test(f);
        const isScript = (f: string) => /\b(script|handwriting|calligraphy)\b/i.test(f);
        const isDisplay = (f: string) => /\b(display|poster|deck|caption|text)\b/i.test(f);
        const isCorporate = (f: string) => /\b(corporate|business)\b/i.test(f);
        const isPro = (f: string) => /\b(pro|expert|plus|extra)\b/i.test(f);
        
        const sameType = (isCondensed(family) === isCondensed(otherFamily)) && 
                         (isExtended(family) === isExtended(otherFamily)) &&
                         (isMono(family) === isMono(otherFamily)) &&
                         (isHollow(family) === isHollow(otherFamily)) &&
                         (isRounded(family) === isRounded(otherFamily)) &&
                         (isSlab(family) === isSlab(otherFamily)) &&
                         (isSans(family) === isSans(otherFamily)) &&
                         (isSerif(family) === isSerif(otherFamily)) &&
                         (isScript(family) === isScript(otherFamily)) &&
                         (isDisplay(family) === isDisplay(otherFamily)) &&
                         (isCorporate(family) === isCorporate(otherFamily)) &&
                         (isPro(family) === isPro(otherFamily));

        // Stricter grouping logic:
        // 1. Prefix must be a word boundary if it's one of the names
        const familyBase = family.toLowerCase();
        const otherBase = otherFamily.toLowerCase();
        const isPrefixMatch = (prefix.length >= 4 && (
          (familyBase.startsWith(otherBase) && (familyBase.length === otherBase.length || familyBase[otherBase.length] === ' ')) ||
          (otherBase.startsWith(familyBase) && (otherBase.length === familyBase.length || otherBase[familyBase.length] === ' '))
        ));

        if (isPrefixMatch && sameType) {
          variations.push(...resolvedFonts[otherFamily]);
          processedFamilies.add(otherFamily);
          // Keep the shorter name as the main family name during grouping if it's a perfect prefix
          if (familyBase.startsWith(otherBase)) targetFamily = otherFamily;
        }
      }
      
      // Deduplicate variations in the grouped family
      const uniqueVariations: any[] = [];
      variations.forEach(v => {
        // Use subfamily in the check to prevent merging distinct variations like 'Regular' and 'Mono'
        // if they both end up with the same weight/style (e.g. 400 normal)
        const exists = uniqueVariations.some(ev => 
          ev.weight === v.weight && 
          ev.style === v.style && 
          (ev.subfamily === v.subfamily || !ev.subfamily || !v.subfamily)
        );
        
        if (!exists) {
          uniqueVariations.push({ ...v, family: targetFamily });
        } else if (v.format === 'woff2') {
          const idx = uniqueVariations.findIndex(ev => 
            ev.weight === v.weight && 
            ev.style === v.style && 
            (ev.subfamily === v.subfamily || !ev.subfamily || !v.subfamily)
          );
          uniqueVariations[idx] = { ...v, family: targetFamily };
        }
      });
      
      finalResult[targetFamily] = uniqueVariations;
    }

    const result = Object.entries(finalResult)
      .filter(([_, variations]) => variations.length > 0)
      .map(([family, variations]) => ({ family, variations }));

    res.json({ fonts: result });
  } catch (error: any) {
    console.error(`Scan error: ${error.message}`);
    
    let userMessage = `סריקת האתר נכשלה: ${error.message}`;
    
    if (error.response?.status === 403) {
      userMessage = "הגישה לאתר זה נחסמה (שגיאה 403). ייתכן שהאתר מזהה סריקה אוטומטית וחוסם אותה.";
    } else if (error.code === 'ECONNABORTED') {
      userMessage = "הסריקה נפסקה עקב זמן טעינה ארוך מדי. האתר איטי מאוד או חוסם אותנו.";
    } else if (error.code === 'ENOTFOUND') {
      userMessage = "כתובת האתר לא נמצאה. וודאו שהזנתם כתובת תקינה.";
    }
    
    res.status(error.response?.status || 500).json({ error: userMessage });
  }
});

router.post("/download", async (req, res) => {
  const { fonts, referer } = req.body;
  if (!fonts || !Array.isArray(fonts)) return res.status(400).json({ error: "Fonts array is required" });

  const zip = new AdmZip();
  const errors: string[] = [];
  const successes: string[] = [];

  try {
    const reportLogs: string[] = [];
    const familyNamesList = Array.from(new Set(fonts.map(v => v.family)));
    const isSingleFamily = familyNamesList.length === 1;
    const downloadLimit = pLimit(5); // Download 5 fonts at a time

    await Promise.all(fonts.map(font => downloadLimit(async () => {
      if (!font.url) {
        reportLogs.push(`Skipping font with empty URL: ${font.family}`);
        return;
      }
      
      reportLogs.push(`\n--- Processing: ${font.family} (${font.weight} ${font.style}) ---`);
      reportLogs.push(`URL: ${font.url}`);
      
      try {
        let buffer: Buffer;
        let ext: string;

        if (font.url.startsWith("data:")) {
          reportLogs.push(`Source: Data URL`);
          const parts = font.url.split(",");
          const mime = parts[0].match(/:(.*?);/)?.[1] || "font/woff2";
          buffer = Buffer.from(parts[1], "base64");
          ext = mime.split("/").pop() || "woff2";
        } else {
          let absoluteUrl = font.url;
          if (!font.url.startsWith("http")) {
            try {
              absoluteUrl = new URL(font.url, referer).href;
            } catch (e) {}
          }
          
          reportLogs.push(`Source: ${absoluteUrl}`);
          const fontUrlObj = new URL(absoluteUrl);
          const response = await axios.get(absoluteUrl, {
            responseType: "arraybuffer",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "*/*",
              "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
              "Referer": referer || fontUrlObj.origin,
              "Origin": fontUrlObj.origin,
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
              "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"Windows"',
              "Sec-Fetch-Dest": "font",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Site": "cross-site"
            },
            timeout: 30000, // Increased timeout to 30s
            maxRedirects: 5,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024
          });

          const contentType = response.headers['content-type'] || '';
          reportLogs.push(`Content-Type: ${contentType}`);
          
          if (contentType.includes('text/html')) {
            throw new Error("Server returned HTML instead of a font file (possible anti-leech or 404)");
          }

          buffer = Buffer.from(response.data);
          reportLogs.push(`Downloaded Size: ${buffer.length} bytes`);
          
          // Check for truncation
          if (response.headers['content-length'] && buffer.length < parseInt(response.headers['content-length'])) {
            reportLogs.push(`WARNING: Font data might be truncated: ${buffer.length} vs ${response.headers['content-length']}`);
          }
          
          // 1. Check if the buffer is actually a base64 string
          const possibleString = buffer.toString('utf8', 0, 1000);
          const isBase64 = possibleString.includes('base64,') || 
                          (/^[a-zA-Z0-9+/= \r\n]+$/.test(possibleString.slice(0, 500)) && buffer.length > 1000);
          
          if (isBase64) {
            try {
              const fullString = buffer.toString('utf8');
              const actualBase64 = fullString.includes('base64,') ? fullString.split('base64,')[1] : fullString;
              const decoded = Buffer.from(actualBase64.replace(/[^a-zA-Z0-9+/=]/g, ''), 'base64');
              if (decoded.length > 500) {
                buffer = decoded;
                reportLogs.push(`Detected and decoded base64 font data. New size: ${buffer.length} bytes`);
              }
            } catch (e) {
              reportLogs.push(`WARNING: Failed to decode suspected base64 data`);
            }
          }

          // 2. Check for compression (GZIP, ZLIB, DEFLATE)
          const tryDecompress = (data: Buffer): Buffer => {
            // GZIP
            if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) {
              try {
                reportLogs.push(`Detected GZIP compression, decompressing...`);
                return zlib.gunzipSync(data);
              } catch (e) {}
            }
            // ZLIB / DEFLATE
            if (data.length > 2 && (data[0] === 0x78)) {
              try {
                reportLogs.push(`Detected ZLIB/Deflate compression, decompressing...`);
                return zlib.inflateSync(data);
              } catch (e) {}
            }
            return data;
          };

          buffer = tryDecompress(buffer);
          reportLogs.push(`Initial buffer size: ${buffer.length} bytes`);

          if (buffer.length < 500) {
            throw new Error(`Downloaded file is too small (${buffer.length} bytes) to be a valid font`);
          }

          ext = font.format || absoluteUrl.split(".").pop()?.split("?")[0].toLowerCase() || "woff2";
        }
        
        let originalBuffer = buffer;
        let originalExt = ext;
        let finalExt = ext;

        try {
          const result = await processFontSuperAggressively(buffer, ext, font.family, font.weight, font.style);
          buffer = result.buffer;
          finalExt = result.ext;
        } catch (e: any) {
          reportLogs.push(`CRITICAL ERROR in repair pipeline: ${e.message}`);
          buffer = originalBuffer;
          finalExt = originalExt === 'opentype' ? 'otf' : originalExt;
        }
        
        // Sanitize filename
        const familySafe = font.family.replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
        const weightNames: Record<string, string> = {
          '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
          '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '1000': 'Black', '900': 'Black', '950': 'Black'
        };
        const weightSafe = weightNames[font.weight] || font.weight.toString().replace(/[^a-zA-Z0-9]/g, '');
        const styleSafe = font.style && font.style !== 'normal' ? `-${font.style.charAt(0).toUpperCase() + font.style.slice(1)}` : '';
        let filename = `${familySafe}-${weightSafe}${styleSafe}.${finalExt}`;
        
        // Helper to check if a name looks like a "messy" automated webfont name
        const isMessyName = (name: string) => {
          const lower = name.toLowerCase();
          if (lower.includes('webfont')) return true;
          // All lowercase, no separators, and relatively long
          if (lower === name && name.length > 12 && !name.includes('-') && !name.includes('_')) return true;
          return false;
        };

        if (font.originalName && !isMessyName(font.originalName)) {
          const parts = font.originalName.split('.');
          if (parts.length > 1) {
            parts.pop(); // remove original extension
          }
          const baseSafe = parts.join('.').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 40);
          filename = `${baseSafe}.${finalExt}`;
        } else if (font.url && !font.url.startsWith("data:")) {
          try {
            const urlObj = new URL(font.url);
            const lastPart = urlObj.pathname.split('/').pop();
            if (lastPart) {
              const baseName = lastPart.split('?')[0];
              if (baseName.includes('.')) {
                const nameParts = baseName.split('.');
                nameParts.pop();
                const baseSafe = nameParts.join('.').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 30);
                if (!isMessyName(baseSafe)) {
                  filename = `${baseSafe}.${finalExt}`;
                }
              }
            }
          } catch (e) {}
        }
        
        // Ensure filename is unique in zip
        let finalPath = isSingleFamily ? filename : `${familySafe}/${filename}`;
        let counter = 1;
        while (zip.getEntry(finalPath)) {
          const parts = filename.split(".");
          const extPart = parts.pop();
          const newFilename = `${parts.join(".")}-${counter}.${extPart}`;
          finalPath = isSingleFamily ? newFilename : `${familySafe}/${newFilename}`;
          counter++;
        }

        zip.addFile(finalPath, buffer);
        successes.push(`${font.family} (${font.weight} ${font.style}) -> ${filename}`);
      } catch (e: any) {
        errors.push(`נכשל בהורדת ${font.family} (${font.weight} ${font.style}): ${e.message}`);
      }
    })));

    if (zip.getEntries().length === 0) {
      return res.status(500).json({ error: "נכשל בהורדת כל הפונטים שנבחרו", details: errors });
    }

    const familyNames = Array.from(new Set(fonts.map(v => v.family))).join("-").replace(/\s+/g, "-").toLowerCase();
    const zipName = `${familyNames}.zip`;
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename=${zipName}`);
    res.send(zip.toBuffer());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use("/api", router);

// Global error handler to ensure JSON responses instead of HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Error Handler:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ 
    error: err.message || "שגיאת שרת פנימית",
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export default app;
