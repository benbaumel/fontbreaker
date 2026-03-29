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
  'thin': '100', 'hairline': '100', 'extralight': '200', 'ultralight': '200', 'light': '300',
  'book': '400', 'regular': '400', 'normal': '400', 'medium': '500', 'semibold': '600',
  'demibold': '600', 'bold': '700', 'extrabold': '800', 'ultrabold': '800', 'black': '900',
  'heavy': '900', 'fat': '900', 'poster': '900',
};

const extractWeight = (name: string) => {
  const lower = name.toLowerCase();
  const match = lower.match(/(?:^|[^0-9])(\d{3})(?:$|[^0-9])/);
  if (match) return match[1];
  for (const [key, val] of Object.entries(weightKeywords)) {
    if (lower.includes(key)) return val;
  }
  return null;
};

const normalizeFamily = (f: string) => {
  if (!f) return "Unknown Font";
  if (f === "Preloaded Font" || f === "Discovered Font") return f;
  let clean = f.replace(/\b(hairline|thin|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|fat|poster|italic|oblique|condensed|expanded|narrow|wide|webfont)\b/gi, '')
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.toLowerCase().includes("font style") || clean.toLowerCase().includes("myfont")) {
    clean = clean.replace(/\d+$/, '').replace(/(font style|myfont)/gi, '').trim();
  }
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

    // Fetch and parse external CSS (limited to 3 to avoid timeouts)
    const ssUrls = Array.from(stylesheetUrls).slice(0, 3);
    for (const ssUrl of ssUrls) {
      try {
        const ssResponse = await axios.get(ssUrl, { timeout: 1000 });
        fontData.push(...extractFontsFromCss(ssResponse.data, ssUrl));
      } catch (e) {}
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
      if (finalFonts[cleanFamily].some(v => v.url === fUrl)) return;

      const normalizedWeight = normalizeWeight(weight, bestFamily, fUrl);
      const normalizedStyle = style.toLowerCase().trim() || (fUrl.toLowerCase().includes('italic') ? 'italic' : 'normal');
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
    const familyNamesList = Array.from(new Set(fonts.map(v => v.family)));
    const isSingleFamily = familyNamesList.length === 1;

    for (const font of fonts) {
      // Small delay to avoid hitting rate limits on some servers
      await new Promise(r => setTimeout(r, 200));
      
      try {
        let buffer: Buffer;
        let ext: string;

        if (font.url.startsWith("data:")) {
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
          
          const fontUrlObj = new URL(absoluteUrl);
          const response = await axios.get(absoluteUrl, {
            responseType: "arraybuffer",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": referer || fontUrlObj.origin,
              "Origin": fontUrlObj.origin
            },
            timeout: 5000
          });
          buffer = Buffer.from(response.data);
          ext = font.format || absoluteUrl.split(".").pop()?.split("?")[0].toLowerCase() || "woff2";
        }
        
        let originalBuffer = buffer;
        let originalExt = ext;
        let finalExt = ext;

        try {
          let fontData = buffer;
          const magic = buffer.slice(0, 4).toString();
          const isTTF = buffer[0] === 0 && buffer[1] === 1 && buffer[2] === 0 && buffer[3] === 0;
          let inputType = ext;

          if (magic === 'wOF2') inputType = 'woff2';
          else if (magic === 'wOFF') inputType = 'woff';
          else if (magic === 'OTTO') inputType = 'otf';
          else if (isTTF || magic === 'true' || magic === 'typ1') inputType = 'ttf';

          if (inputType === 'woff2') {
            try {
              const decompressed = await wawoff2.decompress(buffer);
              fontData = Buffer.from(decompressed);
              const subMagic = fontData.slice(0, 4).toString();
              inputType = subMagic === 'OTTO' ? 'otf' : 'ttf';
            } catch (e) {}
          }

          try {
            const fontObj = Font.create(fontData, { type: inputType as any });
            const out = fontObj.write({ type: 'ttf' });
            if (out) {
              buffer = Buffer.from(out as any);
              finalExt = 'ttf';
            }
          } catch (e) {
            try {
              const fontObj = Font.create(fontData, { type: inputType as any });
              const out = fontObj.write({ type: 'otf' });
              if (out) {
                buffer = Buffer.from(out as any);
                finalExt = 'otf';
              }
            } catch (e2) {
              // Fallback to original if conversion fails
              buffer = fontData;
              finalExt = inputType === 'woff' || inputType === 'woff2' ? 'ttf' : inputType;
            }
          }
        } catch (e) {
          buffer = originalBuffer;
          finalExt = originalExt;
        }
        
        let filename = `${font.family.replace(/\s+/g, '-')}-${font.weight}-${font.style}.${finalExt}`;
        if (font.url && !font.url.startsWith("data:")) {
          try {
            const urlObj = new URL(font.url);
            const lastPart = urlObj.pathname.split('/').pop();
            if (lastPart) {
              const baseName = lastPart.split('?')[0];
              if (baseName.includes('.')) {
                const nameParts = baseName.split('.');
                nameParts.pop();
                filename = `${nameParts.join('.')}.${finalExt}`;
              }
            }
          } catch (e) {}
        }

        if (isSingleFamily) {
          zip.addFile(filename, buffer);
        } else {
          const folderName = font.family.replace(/[<>:"/\\|?*]/g, '').trim();
          zip.addFile(`${folderName}/${filename}`, buffer);
        }
        successes.push(`${font.family} (${font.weight} ${font.style}) -> ${filename}`);
      } catch (e: any) {
        errors.push(`נכשל בהורדת ${font.family} (${font.weight} ${font.style}): ${e.message}`);
      }
    }

    if (errors.length > 0) {
      const report = `FontBreaker Download Report\n==========================\n\nSuccesses:\n${successes.join('\n')}\n\nFailures:\n${errors.join('\n')}`;
      zip.addFile("report.txt", Buffer.from(report));
    }

    if (zip.getEntries().length === 0 || (zip.getEntries().length === 1 && zip.getEntry("report.txt"))) {
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
