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

// ESM shims
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as opentype from 'opentype.js';

const app = express();
app.use(cors());
app.use(express.json());

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
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": (typeof referer === 'string' ? referer : urlObj.origin),
        "Origin": urlObj.origin
      },
      timeout: 5000
    });
    res.set("Content-Type", response.headers["content-type"] || "font/woff2");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(response.data));
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

const resolveUrl = (fontUrl: string, baseUrl: string) => {
  if (!fontUrl) return "";
  fontUrl = fontUrl.trim();
  if (fontUrl.startsWith("data:")) return fontUrl;
  if (fontUrl.startsWith("//")) return "https:" + fontUrl;
  if (fontUrl.startsWith("http")) return fontUrl;
  try {
    const url = new URL(fontUrl, baseUrl);
    return url.href;
  } catch (e) {
    return fontUrl;
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
            fonts.push({ family, url, weight, style });
          });
        }
      }
    });
  } catch (e) {
    // Fallback regex if css-tree fails
    const fontFaceRegex = /@font-face\s*{([^}]*)}/gi;
    let match;
    while ((match = fontFaceRegex.exec(css)) !== null) {
      const content = match[1];
      const familyMatch = content.match(/font-family\s*:\s*([^;]+)/i);
      const srcMatch = content.match(/src\s*:\s*([^;]+)/i);
      if (familyMatch && srcMatch) {
        const family = familyMatch[1].replace(/['"]/g, "").trim();
        const weightMatch = content.match(/font-weight\s*:\s*([^;]+)/i);
        const styleMatch = content.match(/font-style\s*:\s*([^;]+)/i);
        const weight = weightMatch ? weightMatch[1].trim() : "400";
        const style = styleMatch ? styleMatch[1].trim() : "normal";
        const urlMatches = srcMatch[1].match(/url\s*\(\s*['"]?([^'")]*)['"]?\s*\)/g);
        if (urlMatches) {
          urlMatches.forEach(uMatch => {
            const fontUrl = uMatch.replace(/url\s*\(\s*['"]?|['"]?\s*\)/g, "").trim();
            if (fontUrl) {
              fonts.push({ family, url: resolveUrl(fontUrl, baseUrl), weight, style });
            }
          });
        }
      }
    }
  }
  return fonts;
};

const weightKeywords: Record<string, string> = {
  'thin': '100', 'hairline': '100', 
  'extra-light': '200', 'extralight': '200', 'ultra-light': '200', 'ultralight': '200', 
  'light': '300',
  'book': '400', 'regular': '400', 'normal': '400', 
  'medium': '500', 
  'semi-bold': '600', 'semibold': '600', 'demi-bold': '600', 'demibold': '600', 
  'bold': '700', 
  'extra-bold': '800', 'extrabold': '800', 'ultra-bold': '800', 'ultrabold': '800', 
  'black': '900', 'heavy': '900', 'fat': '900', 'poster': '900',
};

const extractWeight = (name: string) => {
  const lower = name.toLowerCase();
  // Look for exact 3-digit weight (100-900)
  const match = lower.match(/\b([1-9]00)\b/);
  if (match) return match[1];
  
  // Look for keywords
  for (const [key, val] of Object.entries(weightKeywords)) {
    if (lower.includes(key)) return val;
  }
  return null;
};

const normalizeFamily = (f: string) => {
  if (!f) return "Unknown Font";
  if (f === "Preloaded Font" || f === "Discovered Font") return f;
  
  // Remove common suffixes and weight/style keywords from family name
  let clean = f.replace(/['"]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b(hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|poster|italic|oblique|condensed|expanded|narrow|wide|webfont|woff2?|ttf|otf|eot|svg)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.toLowerCase().includes("font style") || clean.toLowerCase().includes("myfont")) {
    clean = clean.replace(/\d+$/, '').replace(/(font style|myfont)/gi, '').trim();
  }
  
  // Title Case
  clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return clean || f.trim() || "Unknown Font";
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

router.post("/scan", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  console.log(`Scanning URL: ${url}`);
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      },
      timeout: 4000
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const baseUrl = url;
    const fontData: any[] = [];

    // 1. Parse inline <style> tags
    $('style').each((_, el) => {
      const css = $(el).text();
      fontData.push(...extractFontsFromCss(css, baseUrl));
    });

    // 2. Parse external <link rel="stylesheet">
    const stylesheetUrls = new Set<string>();
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) stylesheetUrls.add(resolveUrl(href, baseUrl));
    });

    // Fetch and parse external CSS with @import support
    const processedSsUrls = new Set<string>();
    const ssQueue = Array.from(stylesheetUrls);
    let processedCount = 0;
    const MAX_SS = 30; // Increased limit to find more weights

    while (ssQueue.length > 0 && processedCount < MAX_SS) {
      const ssUrl = ssQueue.shift()!;
      if (processedSsUrls.has(ssUrl)) continue;
      processedSsUrls.add(ssUrl);
      processedCount++;

      try {
        const ssResponse = await axios.get(ssUrl, { 
          timeout: 3000, // Increased timeout
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }
        });
        const css = ssResponse.data;
        if (typeof css === 'string') {
          fontData.push(...extractFontsFromCss(css, ssUrl));
          
          // Find @imports recursively
          const importRegex = /@import\s+(?:url\s*\(\s*['"]?|['"])([^'")]*)(?:['"]?|['"]\s*\);?)/gi;
          let match;
          while ((match = importRegex.exec(css)) !== null) {
            const importedUrl = resolveUrl(match[1], ssUrl);
            if (!processedSsUrls.has(importedUrl)) {
              ssQueue.push(importedUrl);
            }
          }
        }
      } catch (e) {
        console.log(`Failed to fetch stylesheet: ${ssUrl}`);
      }
    }

    // 3. Check for preload links
    $('link[rel="preload"][as="font"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        fontData.push({ family: "Preloaded Font", url: resolveUrl(href, baseUrl), weight: "400", style: "normal", isPreload: true });
      }
    });

    // 4. Fallback: Search for font-like URLs in HTML
    const absUrls = Array.from(new Set(html.match(/https?:\/\/[^"']+\.(woff2?|ttf|otf|eot|svg)(?:\?.*)?/gi) || []));
    absUrls.forEach((fUrl: string) => {
      fontData.push({ family: "Discovered Font", url: fUrl, weight: "400", style: "normal", isDiscovered: true });
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
          .replace(/\b(hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|poster|italic|oblique|condensed|expanded|narrow|wide|webfont|woff2?|ttf|otf|eot|svg)\b/gi, '')
          .trim();
        if (guessed && guessed.length > 2) bestFamily = guessed;
      }
      
      const cleanFamily = normalizeFamily(bestFamily);
      
      if (!finalFonts[cleanFamily]) finalFonts[cleanFamily] = [];
      
      const normalizedWeight = normalizeWeight(weight, bestFamily, fUrl);
      
      let normalizedStyle = style.toLowerCase().trim();
      if (normalizedStyle === 'normal' || !normalizedStyle) {
        if (family.toLowerCase().includes('italic') || fUrl.toLowerCase().includes('italic') || filename.toLowerCase().includes('italic')) {
          normalizedStyle = 'italic';
        } else {
          normalizedStyle = 'normal';
        }
      }

      const format = fUrl.split('.').pop()?.split('?')[0].toLowerCase() || 'unknown';
      
      const existingIdx = finalFonts[cleanFamily].findIndex(v => v.weight === normalizedWeight && v.style === normalizedStyle);
      if (existingIdx === -1) {
        finalFonts[cleanFamily].push({ family: cleanFamily, url: fUrl, weight: normalizedWeight, style: normalizedStyle, format });
        allUrls.add(fUrl);
      } else {
        const existing = finalFonts[cleanFamily][existingIdx];
        if (format === 'woff2' && existing.format !== 'woff2') {
          finalFonts[cleanFamily][existingIdx] = { family: cleanFamily, url: fUrl, weight: normalizedWeight, style: normalizedStyle, format };
          allUrls.add(fUrl);
        }
      }
    };

    fontData.forEach(f => {
      addVariation(f.family, f.url, f.weight || "400", f.style || "normal");
    });

    const result = Object.entries(finalFonts)
      .filter(([_, variations]) => variations.length > 0)
      .map(([family, variations]) => ({ family, variations }));

    res.json({ fonts: result });
  } catch (error: any) {
    console.error(`Scan error: ${error.message}`);
    res.status(500).json({ error: `סריקת האתר נכשלה: ${error.message}` });
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

    for (const font of fonts) {
      reportLogs.push(`\n--- Processing: ${font.family} (${font.weight} ${font.style}) ---`);
      reportLogs.push(`URL: ${font.url}`);
      
      // Small delay to avoid hitting rate limits on some servers
      await new Promise(r => setTimeout(r, 200));
      
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
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
              "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
              "Referer": referer || fontUrlObj.origin,
              "Origin": fontUrlObj.origin,
              "Cache-Control": "no-cache",
              "Pragma": "no-cache"
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
          const processFontSuperAggressively = async (data: Buffer, hintedType: string): Promise<{ buffer: Buffer, ext: string }> => {
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
                // Search for 'fvar' tag in the buffer
                return d.indexOf(Buffer.from('fvar')) !== -1;
              } catch (e) {
                return false;
              }
            };

            const rebuildWithFontEditor = (d: Buffer, type: string, forceClean: boolean = false): Buffer | null => {
              try {
                let fontObj: any = null;
                let detectedType = type;
                
                const tryTypes = [type, 'ttf', 'woff', 'woff2', 'otf', 'eot'];
                for (const t of tryTypes) {
                  try {
                    fontObj = Font.create(d, { type: t as any, hinting: true });
                    detectedType = t;
                    if (fontObj.get().glyf && fontObj.get().glyf.length > 0) break;
                  } catch (err) {}
                }
                
                if (!fontObj) return null;
                const ttf = fontObj.get() as any;
                
                if (!ttf.glyf || ttf.glyf.length === 0) {
                  return null;
                }
                
                const cleanName = (s: any) => {
                  if (typeof s !== 'string') return '';
                  return s.replace(/[^\x00-\x7F]/g, '').trim();
                };

                let family = cleanName(ttf.name?.fontFamily) || font.family.replace(/[^\x00-\x7F]/g, '') || 'FontBreaker';
                let subFamily = cleanName(ttf.name?.fontSubFamily) || 'Regular';
                
                if (!family || family.length < 2) family = 'FontBreaker';
                const psName = family.replace(/[^a-zA-Z0-9]/g, '') || 'FontBreaker';
                const fullName = `${family} ${subFamily}`;
                const uniqueId = `${family} ${subFamily} ${Date.now()}`;

                ttf.name = [
                  { nameID: 1, platformID: 3, encodingID: 1, languageID: 1033, nameString: family },
                  { nameID: 2, platformID: 3, encodingID: 1, languageID: 1033, nameString: subFamily },
                  { nameID: 3, platformID: 3, encodingID: 1, languageID: 1033, nameString: uniqueId },
                  { nameID: 4, platformID: 3, encodingID: 1, languageID: 1033, nameString: fullName },
                  { nameID: 6, platformID: 3, encodingID: 1, languageID: 1033, nameString: psName },
                  { nameID: 1, platformID: 1, encodingID: 0, languageID: 0, nameString: family },
                  { nameID: 2, platformID: 1, encodingID: 0, languageID: 0, nameString: subFamily },
                  { nameID: 4, platformID: 1, encodingID: 0, languageID: 0, nameString: fullName },
                  { nameID: 6, platformID: 1, encodingID: 0, languageID: 0, nameString: psName }
                ];

                if (!ttf.head || forceClean) {
                  ttf.head = {
                    version: 1, fontRevision: 1, checkSumAdjustment: 0, magicNumber: 0x5F0F3CF5,
                    flags: 0x0003, unitsPerEm: ttf.head?.unitsPerEm || 1000, created: ttf.head?.created || Date.now(),
                    modified: Date.now(), xMin: ttf.head?.xMin || 0, yMin: ttf.head?.yMin || -200,
                    xMax: ttf.head?.xMax || 1000, yMax: ttf.head?.yMax || 1000, macStyle: 0,
                    lowestRecPPEM: 8, fontDirectionHint: 2, indexToLocFormat: 0, glyphDataFormat: 0
                  };
                }

                if (!ttf.hhea || forceClean) {
                  ttf.hhea = {
                    version: 1, ascent: ttf.hhea?.ascent || 1000, descent: ttf.hhea?.descent || -200,
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
                const outType = (type === 'otf') ? 'otf' : 'ttf';
                const out = fontObj.write({ type: outType as any, hinting: false });
                return out ? Buffer.from(out as any) : null;
              } catch (e: any) {
                return null;
              }
            };

            const rebuildWithOpenType = (d: Buffer): Buffer | null => {
              try {
                const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
                const fontParsed = opentype.parse(ab);
                
                if (fontParsed.tables.fvar) {
                  return null; // Don't touch variable fonts with opentype.js
                }

                const rawFamily = fontParsed.names.fontFamily?.en || fontParsed.names.fontFamily?.he || 'FontBreaker';
                const family = typeof rawFamily === 'string' ? rawFamily.replace(/[^\x00-\x7F]/g, '') : 'FontBreaker';
                const subFamily = fontParsed.names.fontSubfamily?.en || 'Regular';
                fontParsed.names.fontFamily = { en: family || 'FontBreaker' };
                fontParsed.names.fontSubfamily = { en: subFamily };
                fontParsed.names.fullName = { en: `${family || 'FontBreaker'} ${subFamily}` };
                fontParsed.names.postScriptName = { en: (family || 'FontBreaker').replace(/\s+/g, '') };
                const out = fontParsed.toBuffer();
                return out ? Buffer.from(out) : null;
              } catch (e: any) {
                return null;
              }
            };

            const bruteForceOpenTypeRepair = (d: Buffer): Buffer | null => {
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
                const family = font.family.replace(/[^\x00-\x7F]/g, '') || 'FontBreaker';
                const newFont = new opentype.Font({
                  familyName: family,
                  styleName: 'Regular',
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

            const candidates: { buffer: Buffer, type: string, note: string }[] = [
              { buffer: data, type: hintedType, note: 'original' }
            ];

            const signatures = [
              { sig: Buffer.from([0x77, 0x4F, 0x46, 0x32]), type: 'woff2' },  // wOF2
              { sig: Buffer.from([0x77, 0x4F, 0x46, 0x46]), type: 'woff' },   // wOFF
              { sig: Buffer.from([0x00, 0x01, 0x00, 0x00]), type: 'ttf' },    // ttf
              { sig: Buffer.from([0x4F, 0x54, 0x54, 0x4F]), type: 'otf' },    // otf
              { sig: Buffer.from([0x45, 0x4F, 0x54]), type: 'eot' },          // EOT
            ];

            for (const s of signatures) {
              let lastIdx = -1;
              while (true) {
                const idx = data.indexOf(s.sig, lastIdx + 1);
                if (idx === -1 || idx > 4096) break;
                if (idx > 0) {
                  candidates.push({ 
                    buffer: data.slice(idx), 
                    type: s.type, 
                    note: `trimmed ${idx} bytes to ${s.type}` 
                  });
                }
                lastIdx = idx;
                if (s.type !== 'ttf') break;
              }
            }

            reportLogs.push(`Generated ${candidates.length} candidate buffers for repair`);

            for (const cand of candidates) {
              reportLogs.push(`Trying candidate: ${cand.note} (size: ${cand.buffer.length})`);
              let currentData = cand.buffer;
              let currentType = cand.type;

              const magic = currentData.slice(0, 4).toString();
              if (magic === 'wOF2' || currentType === 'woff2') {
                try {
                  const decompressed = await wawoff2.decompress(currentData);
                  currentData = Buffer.from(decompressed);
                  currentType = currentData.slice(0, 4).toString() === 'OTTO' ? 'otf' : 'ttf';
                  reportLogs.push(`  - WOFF2 decompressed to ${currentType}`);
                } catch (e) {}
              }

              // 0. Check if it's a variable font - if so, use as-is if it's even remotely valid
              if (isVariableFont(currentData)) {
                reportLogs.push(`  - SUCCESS: Variable font detected. Using as-is to preserve variations.`);
                return { buffer: currentData, ext: currentType === 'otf' ? 'otf' : 'ttf' };
              }

              // 1. If it's already a valid font, try to clean it but don't force it
              if (validateFont(currentData)) {
                const touched = rebuildWithOpenType(currentData);
                if (touched && validateFont(touched)) {
                  reportLogs.push(`  - SUCCESS: Valid font cleaned with OpenType.js (${cand.note})`);
                  return { buffer: touched, ext: 'ttf' };
                }
                reportLogs.push(`  - SUCCESS: Valid font used as-is to avoid over-processing (${cand.note})`);
                return { buffer: currentData, ext: currentType === 'otf' ? 'otf' : 'ttf' };
              }

              // 2. If NOT valid, try aggressive repairs
              // Try OpenType.js first (sometimes it can fix minor structural issues)
              let result = rebuildWithOpenType(currentData);
              if (result && validateFont(result)) {
                reportLogs.push(`  - SUCCESS: Rebuilt using OpenType.js (${cand.note})`);
                return { buffer: result, ext: 'ttf' };
              }

              // Try FontEditor-Core (Aggressive)
              result = rebuildWithFontEditor(currentData, currentType);
              if (result && validateFont(result)) {
                reportLogs.push(`  - SUCCESS: Rebuilt using FontEditor-Core (${cand.note})`);
                return { buffer: result, ext: 'ttf' };
              }

              // Try Brute-Force
              result = bruteForceOpenTypeRepair(currentData);
              if (result && validateFont(result)) {
                reportLogs.push(`  - SUCCESS: Rebuilt using Brute-Force (${cand.note})`);
                return { buffer: result, ext: 'ttf' };
              }
            }

            const types = ['ttf', 'otf', 'woff', 'eot'];
            for (const t of types) {
              for (const cand of candidates) {
                let result = rebuildWithFontEditor(cand.buffer, t);
                if (result && validateFont(result)) {
                  reportLogs.push(`  - SUCCESS: Rebuilt using FontEditor-Core (${t} fallback, ${cand.note})`);
                  return { buffer: result, ext: 'ttf' };
                }
              }
            }

            reportLogs.push(`WARNING: All repair strategies failed for all candidates. Using original data.`);
            return { buffer: data, ext: hintedType === 'woff2' || hintedType === 'woff' ? 'ttf' : hintedType };
          };

          const result = await processFontSuperAggressively(buffer, ext);
          buffer = result.buffer;
          finalExt = result.ext;
        } catch (e: any) {
          reportLogs.push(`CRITICAL ERROR in repair pipeline: ${e.message}`);
          buffer = originalBuffer;
          finalExt = originalExt;
        }
        
        // Sanitize filename
        const familySafe = font.family.replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
        const weightSafe = font.weight.toString().replace(/[^a-zA-Z0-9]/g, '');
        let filename = `${familySafe}-${weightSafe}-${font.style}.${finalExt}`;
        
        if (font.url && !font.url.startsWith("data:")) {
          try {
            const urlObj = new URL(font.url);
            const lastPart = urlObj.pathname.split('/').pop();
            if (lastPart) {
              const baseName = lastPart.split('?')[0];
              if (baseName.includes('.')) {
                const nameParts = baseName.split('.');
                nameParts.pop();
                const baseSafe = nameParts.join('.').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 30);
                filename = `${baseSafe}.${finalExt}`;
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
    }

    if (zip.getEntries().length === 0) {
      return res.status(500).json({ error: "נכשל בהורדת כל הפונטים שנבחרו", details: errors });
    }

    const familyNames = Array.from(new Set(fonts.map(v => v.family))).join("-").replace(/\s+/g, "-").toLowerCase();
    const zipName = `fontbreaker-${familyNames}.zip`;
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename=${zipName}`);
    res.send(zip.toBuffer());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use("/api", router);

export default app;
