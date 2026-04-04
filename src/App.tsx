import React, { useState, useCallback, useMemo, memo } from "react";
import { Search, Download, Check, Loader2, Globe, Hammer, LogOut, Settings2, Sliders, Zap, Copy, ExternalLink, X, Upload, MousePointer2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";

interface FontVariation {
  family: string;
  url: string;
  format: string;
  weight: string;
  style: string;
  originalName?: string;
  isVariable?: boolean;
  axes?: {
    tag: string;
    minValue: number;
    defaultValue: number;
    maxValue: number;
    name: string;
  }[];
  instances?: {
    name: string;
    coordinates: Record<string, number>;
  }[];
}

interface FontGroup {
  family: string;
  variations: FontVariation[];
}

const weightMap: Record<string, string> = {
  "100": "100",
  "200": "200",
  "300": "300",
  "400": "400",
  "500": "500",
  "600": "600",
  "700": "700",
  "800": "800",
  "900": "900",
};

const getWeightName = (weight: string) => weight;

interface FontCardProps {
  group: FontGroup;
  selectedVariations: FontVariation[];
  toggleFamily: (group: FontGroup) => void;
  referer: string;
}

const FontCard: React.FC<FontCardProps> = memo(({ group, selectedVariations, toggleFamily, referer }) => {
  const isFamilySelected = useMemo(() => 
    group.variations.every(gv => selectedVariations.some(sv => sv.url === gv.url)),
    [group.variations, selectedVariations]
  );
  
  const previewVariation = useMemo(() => 
    group.variations.find(v => v.weight === '400') || group.variations[0],
    [group.variations]
  );
  
  const isVariable = previewVariation.isVariable;

  // For static fonts, handle multiple weights
  const staticWeights = useMemo(() => 
    Array.from(new Set(group.variations.map(v => parseInt(v.weight)))).sort((a: number, b: number) => a - b),
    [group.variations]
  );
  
  const [selectedVariationUrl, setSelectedVariationUrl] = useState(previewVariation.url);

  const [axisValues, setAxisValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    if (isVariable && previewVariation.axes) {
      previewVariation.axes.forEach(axis => {
        initial[axis.tag] = axis.defaultValue;
      });
    }
    return initial;
  });

  const [showAxes, setShowAxes] = useState(false);

  const PREVIEW_EN = "The quick brown fox jumps over the lazy dog";
  const PREVIEW_HE = "דג סקרן שט בים מאוכזב כשלפתע מצא חברה";

  const fontVariationSettings = useMemo(() => 
    isVariable 
      ? Object.entries(axisValues).map(([tag, val]) => `"${tag}" ${val}`).join(", ")
      : "normal",
    [isVariable, axisValues]
  );

  const currentPreviewVariation = useMemo(() => 
    isVariable 
      ? previewVariation 
      : (group.variations.find(v => v.url === selectedVariationUrl) || previewVariation),
    [isVariable, previewVariation, group.variations, selectedVariationUrl]
  );

  const applyInstance = useCallback((coordinates: Record<string, number>) => {
    setAxisValues(prev => ({ ...prev, ...coordinates }));
  }, []);

  const hasMultipleWeights = staticWeights.length > 1;

  const fontStyles = useMemo(() => (
    group.variations.map((v, idx) => (
      <style key={`style-${v.url}-${idx}`} dangerouslySetInnerHTML={{ __html: `
        @font-face {
          font-family: '${group.family}-${idx}';
          src: url('/api/proxy-font?url=${encodeURIComponent(v.url)}&referer=${encodeURIComponent(referer)}');
          font-weight: ${isVariable ? '1 1000' : v.weight};
          font-style: ${isVariable ? 'normal italic' : (v.style === 'italic' ? 'italic' : 'normal')};
          font-display: swap;
        }
      `}} />
    ))
  ), [group.family, group.variations, referer, isVariable]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      layout
      className={`relative flex flex-col rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        isFamilySelected 
          ? 'border-orange-600 bg-orange-50/30' 
          : 'border-slate-300 bg-white hover:border-slate-400'
      }`}
    >
      {fontStyles}
      {/* Header */}
      <div className="p-4 flex items-center justify-between gap-4 border-b border-slate-300">
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-black tracking-tight truncate text-slate-900">
            {group.family}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 bg-slate-200 px-2 py-0.5 rounded-md">
              {isVariable ? (
                <span className="flex items-center gap-1 text-orange-700">
                  <Sliders className="w-3 h-3" />
                  פונט וריאבילי
                </span>
              ) : (
                <span>{group.variations.length} {group.variations.length === 1 ? 'משקל' : 'משקלים'}</span>
              )}
              <span className="text-slate-400">•</span>
              <span>{previewVariation.format}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isVariable && (
            <button
              onClick={() => setShowAxes(!showAxes)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border-2 active:scale-90 shadow-none ${
                showAxes 
                  ? 'bg-slate-900 border-slate-900 text-white' 
                  : 'bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600'
              }`}
              title="הגדרות פונט וריאבילי"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => toggleFamily(group)}
            title={isFamilySelected ? "בטלו בחירת משפחה" : "בחרו את כל המשקלים במשפחה זו"}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border-2 shadow-none active:scale-90 ${
              isFamilySelected 
                ? 'bg-orange-600 border-orange-600 text-white' 
                : 'bg-white border-slate-400 text-slate-400 hover:border-slate-500 hover:text-slate-600'
            }`}
          >
            <Check className={`w-6 h-6 transition-transform ${isFamilySelected ? 'scale-100' : 'scale-0'}`} />
          </button>
        </div>
      </div>

      {/* Font Controls */}
      <AnimatePresence>
        {showAxes && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-slate-50 border-b border-slate-300 overflow-hidden"
          >
            <div className="p-4 space-y-4">
              {isVariable ? (
                <>
                  {/* Instances */}
                  {previewVariation.instances && previewVariation.instances.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">דגימות מוכנות</span>
                      <div className="flex flex-wrap gap-1">
                        {previewVariation.instances.map((inst, i) => (
                          <button
                            key={i}
                            onClick={() => applyInstance(inst.coordinates)}
                            className="px-2 py-1 bg-white border border-slate-300 rounded-md text-[10px] font-bold hover:border-orange-600 hover:text-orange-600 active:scale-95 transition-all shadow-none"
                          >
                            {inst.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Axes Sliders */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">צירים וריאביליים</span>
                    {previewVariation.axes?.map(axis => (
                      <div key={axis.tag} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-slate-600">{axis.name} ({axis.tag})</label>
                          <span className="text-[10px] font-mono font-bold text-orange-600">{axisValues[axis.tag]}</span>
                        </div>
                        <input
                          type="range"
                          min={axis.minValue}
                          max={axis.maxValue}
                          step={1}
                          value={axisValues[axis.tag]}
                          onChange={(e) => setAxisValues(prev => ({ ...prev, [axis.tag]: parseInt(e.target.value) }))}
                          className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                /* Static Weights Slider */
                <div className="space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">בחירת משקל</span>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-slate-600">משקל (Weight)</label>
                      <span className="text-[10px] font-mono font-bold text-orange-600">{currentPreviewVariation.weight}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={staticWeights.length - 1}
                      step={1}
                      value={staticWeights.indexOf(parseInt(currentPreviewVariation.weight))}
                      onChange={(e) => {
                        const weight = staticWeights[parseInt(e.target.value)];
                        const firstVarWithWeight = group.variations.find(v => parseInt(v.weight) === weight);
                        if (firstVarWithWeight) setSelectedVariationUrl(firstVarWithWeight.url);
                      }}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                    />
                    <div className="flex justify-between px-1">
                      {staticWeights.map((w, i) => (
                        <div key={w} className="text-[8px] font-bold text-slate-400">{w}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Previews */}
      <div className="px-4 py-4 space-y-2 select-none bg-slate-100/50">
        {previewVariation.url === '' && (
          <div className="mb-2 p-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-[9px] font-bold flex items-center gap-2 text-balance">
            נמצאו בשימוש באתר אך הקישורים לקבצים מוסתרים.
          </div>
        )}
        <div className="space-y-1">
          <div 
            className="text-base leading-tight tracking-wide break-words text-slate-700"
            style={{ 
              fontFamily: `'${group.family}-${group.variations.indexOf(currentPreviewVariation)}', sans-serif`,
              fontWeight: isVariable ? undefined : currentPreviewVariation.weight,
              fontStyle: isVariable ? undefined : (currentPreviewVariation.style === 'italic' ? 'italic' : 'normal'),
              fontVariationSettings: fontVariationSettings,
              fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1, "pnum" 1, "tnum" 1, "onum" 1, "lnum" 1, "dlig" 1',
              fontVariantLigatures: 'common-ligatures discretionary-ligatures contextual'
            }}
          >
            {PREVIEW_EN}
          </div>
 
          <div 
            className="text-base leading-tight tracking-wide dir-rtl break-words text-slate-700"
            style={{ 
              fontFamily: `'${group.family}-${group.variations.indexOf(currentPreviewVariation)}', Arial, sans-serif`,
              fontWeight: isVariable ? undefined : currentPreviewVariation.weight,
              fontStyle: isVariable ? undefined : (currentPreviewVariation.style === 'italic' ? 'italic' : 'normal'),
              fontVariationSettings: fontVariationSettings,
              fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1, "pnum" 1, "tnum" 1, "onum" 1, "lnum" 1, "dlig" 1',
              fontVariantLigatures: 'common-ligatures discretionary-ligatures contextual'
            }}
          >
            {PREVIEW_HE}
          </div>
        </div>

        {/* Variations List */}
        {!isVariable && (
          <div className="pt-3 border-t border-slate-300">
            <div className="flex flex-wrap gap-1">
              {group.variations.map((v, idx) => (
                <button 
                  key={`${v.url}-${idx}`} 
                  onClick={() => setSelectedVariationUrl(v.url)}
                  className={`px-2 py-0.5 rounded-md border transition-all text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 shadow-none ${
                    v.url === selectedVariationUrl 
                      ? 'border-slate-300 bg-slate-200 text-slate-900' 
                      : 'border-transparent bg-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-200/30'
                  }`}
                >
                  {v.weight} {v.style !== 'normal' && (v.style === 'italic' ? 'נטוי' : v.style)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default function App() {
  const CORRECT_PASSWORD = '4vT8d9rBpA';
  const STORAGE_KEY = 'fontbreaker_auth';

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState(false);

  const [url, setUrl] = useState("");
  const [lastScannedUrl, setLastScannedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fonts, setFonts] = useState<FontGroup[]>([]);
  const [selectedVariations, setSelectedVariations] = useState<FontVariation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fontSearchQuery, setFontSearchQuery] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("מחלץ פונטים ומשקלים מהאתר...");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadingMessages = [
    "מנתחים קבצי CSS...",
    "מאתרים נתיבי פונטים...",
    "בודקים משקלים וסגנונות...",
    "מכינים תצוגה מקדימה...",
    "מחלצים פונטים ומשקלים מהאתר..."
  ];

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      let i = 0;
      interval = setInterval(() => {
        setLoadingMessage(loadingMessages[i % loadingMessages.length]);
        i++;
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === CORRECT_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem(STORAGE_KEY, 'true');
      setAuthError(false);
      toast.success("ברוכים הבאים! התחברתם בהצלחה");
    } else {
      setAuthError(true);
      setPasswordInput("");
    }
  };

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setShowLogoutConfirm(false);
    localStorage.removeItem(STORAGE_KEY);
    resetApp();
  }, []);

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('fonts', files[i]);
    }

    try {
      const response = await fetch("/api/upload-fonts", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "העלאת הפונטים נכשלה");
      }

      const data = await response.json();
      if (data.fonts && data.fonts.length > 0) {
        setFonts(prev => {
          const newFonts = [...prev];
          data.fonts.forEach((newFont: FontGroup) => {
            const existingIdx = newFonts.findIndex(f => f.family === newFont.family);
            if (existingIdx >= 0) {
              const existingVariations = [...newFonts[existingIdx].variations];
              newFont.variations.forEach((v: FontVariation) => {
                if (!existingVariations.some(ev => ev.url === v.url)) {
                  existingVariations.push(v);
                }
              });
              newFonts[existingIdx] = { ...newFonts[existingIdx], variations: existingVariations };
            } else {
              newFonts.push(newFont);
            }
          });
          return newFonts;
        });
        toast.success(`הועלו ${data.fonts.length} משפחות פונטים!`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  const resetApp = useCallback(() => {
    setUrl("");
    setFonts([]);
    setSelectedVariations([]);
    setError(null);
    setFontSearchQuery("");
    setLoading(false);
  }, []);

  const filteredFonts = useMemo(() => 
    fonts
      .filter(f => f.family.toLowerCase().includes(fontSearchQuery.toLowerCase()))
      .sort((a, b) => {
        const urlLower = lastScannedUrl.toLowerCase();
        const aFamilyLower = a.family.toLowerCase();
        const bFamilyLower = b.family.toLowerCase();
        
        const aInUrl = aFamilyLower.length > 2 && (urlLower.includes(aFamilyLower) || urlLower.includes(aFamilyLower.replace(/\s+/g, '')));
        const bInUrl = bFamilyLower.length > 2 && (urlLower.includes(bFamilyLower) || urlLower.includes(bFamilyLower.replace(/\s+/g, '')));

        if (aInUrl && !bInUrl) return -1;
        if (!aInUrl && bInUrl) return 1;
        
        return b.variations.length - a.variations.length;
      }),
    [fonts, fontSearchQuery, lastScannedUrl]
  );

  const handleScan = useCallback(async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    setFontSearchQuery("");
    let scanUrl = url.trim();
    if (!scanUrl) return;
    if (!scanUrl.startsWith("http://") && !scanUrl.startsWith("https://")) {
      scanUrl = "https://" + scanUrl;
    }
    
    setLoading(true);
    setError(null);
    setFonts([]);
    setSelectedVariations([]);

    try {
      setLastScannedUrl(scanUrl);
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scanUrl }),
      });
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response from server:", text);
        throw new Error(`השרת החזיר תגובה לא תקינה (סוג: ${contentType || 'unknown'}). וודא שהשרת פועל כראוי.`);
      }

      const data = await response.json();
      if (!response.ok) {
        const msg = data.error || "נכשל בחילוץ הפונטים מהאתר";
        toast.error(msg);
        throw new Error(msg);
      }
      
      if (!data.fonts || data.fonts.length === 0) {
        const msg = "לא נמצאו פונטים באתר זה. ייתכן שהאתר חוסם סריקה או שהפונטים מוגנים.";
        toast.error(msg);
        throw new Error(msg);
      }
      
      setFonts(data.fonts);
      toast.success(`נמצאו ${data.fonts.length} משפחות פונטים!`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const toggleFamily = useCallback((group: FontGroup) => {
    const allUrls = group.variations.map(v => v.url);
    const isFullySelected = group.variations.every(gv => selectedVariations.some(sv => sv.url === gv.url));

    if (isFullySelected) {
      setSelectedVariations(prev => prev.filter(v => !allUrls.includes(v.url)));
    } else {
      setSelectedVariations(prev => {
        const otherVariations = prev.filter(v => !allUrls.includes(v.url));
        return [...otherVariations, ...group.variations];
      });
    }
  }, [selectedVariations]);

  const handleDownload = useCallback(async () => {
    if (selectedVariations.length === 0) return;

    setDownloading(true);
    setError(null);
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          fonts: selectedVariations,
          referer: lastScannedUrl 
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          throw new Error(data.error || "ההורדה נכשלה");
        }
        throw new Error("השרת החזיר שגיאה (ייתכן שה-Backend לא מוגדר כראוי)");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      
      const familyNames = Array.from(new Set(selectedVariations.map(v => v.family)))
        .join("-")
        .replace(/\s+/g, "")
        .toLowerCase();
      const zipName = `${familyNames}.zip`;
      
      link.setAttribute("download", zipName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("ההורדה התחילה! הקובץ מוכן");
    } catch (err: any) {
      setError("שגיאה בהורדת הפונטים: " + err.message);
    } finally {
      setDownloading(false);
    }
  }, [selectedVariations, lastScannedUrl]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-2xl p-10 border-2 border-slate-300 text-center shadow-none"
        >
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Hammer className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900 mb-2">
            פונט ברייקר
          </h1>
          <p className="text-slate-500 font-bold mb-8 text-balance">הזינו סיסמה כדי להמשיך</p>
          
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                placeholder="סיסמה..."
                className={`w-full h-14 px-6 rounded-2xl border-2 transition-all outline-none text-center font-bold text-lg shadow-none ${
                  authError ? 'border-red-500 bg-red-50' : 'border-slate-300 focus:border-orange-600'
                }`}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
              {authError && (
                <motion.p 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-500 text-xs font-bold mt-2 text-balance"
                >
                  סיסמה שגויה, נסו שוב
                </motion.p>
              )}
            </div>
            <button
              type="submit"
              title="התחברו למערכת"
              className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-black active:scale-[0.98] transition-all border-2 border-slate-900 shadow-none"
            >
              כניסה
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-orange-600/30" 
      dir="rtl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toaster position="bottom-left" richColors toastOptions={{ className: 'shadow-none border-2 border-slate-300 rounded-2xl font-bold' }} />
      
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-orange-600/90 backdrop-blur-sm flex flex-col items-center justify-center text-white p-10 border-[10px] border-dashed border-white/30 m-4 rounded-[40px] pointer-events-none"
          >
            <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-8">
              <Upload className="w-16 h-16 text-orange-600 animate-bounce" />
            </div>
            <h2 className="text-5xl font-black tracking-tighter mb-4">שחרר כדי להעלות</h2>
            <p className="text-xl font-bold opacity-80">גרור קבצי פונטים לכל מקום במסך</p>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="border-b-2 sticky top-0 z-50 backdrop-blur-md bg-white/95 border-slate-300">
        <div className="max-w-7xl mx-auto px-6 h-24 grid grid-cols-[1fr_2fr_1fr] items-center">
          {/* Left: Logo */}
          <div 
            className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity justify-self-start"
            onClick={resetApp}
            title="חזרה לדף הבית ואיפוס החיפוש"
          >
            <div className="w-12 h-12 bg-orange-600 rounded-2xl flex items-center justify-center">
              <Hammer className="text-white w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black tracking-tighter uppercase text-slate-900 hidden sm:block">
              פונט ברייקר
            </h1>
          </div>

          {/* Center: Scan Form */}
          <form onSubmit={handleScan} className="relative group w-full max-w-3xl justify-self-center">
            <Globe className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-orange-600 transition-colors" />
            <input
              type="url"
              placeholder="הדביקו כתובת אתר..."
              title="הזינו כתובת אתר לסריקה"
              className="w-full h-12 pr-14 pl-28 rounded-full border-2 border-slate-300 focus:border-orange-600 bg-white text-slate-900 placeholder:text-slate-500 transition-all outline-none text-sm font-bold tracking-wide"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <div className="absolute left-1.5 top-1/2 -translate-y-1/2">
              <button
                type="submit"
                disabled={loading || uploading}
                title="סרקו את האתר למציאת פונטים"
                className="h-9 px-6 bg-orange-600 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-orange-700 active:scale-95 disabled:opacity-50 transition-all flex items-center gap-2 shadow-none"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                סרקו
              </button>
            </div>
          </form>

          {/* Right: Actions */}
          <div className="flex items-center gap-3 justify-self-end">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept=".woff,.woff2,.ttf,.otf"
              className="hidden"
            />
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || loading}
              title="העלו קבצי פונטים מהמחשב"
              className="w-12 h-12 rounded-xl border-2 border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 active:scale-95 transition-all flex items-center justify-center bg-white shadow-none"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            </button>

            <button
              onClick={handleDownload}
              disabled={selectedVariations.length === 0 || downloading}
              title="הורידו את כל הפונטים שנבחרו כקובץ ZIP"
              className={`h-12 px-6 rounded-full font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 border-2 shadow-none active:scale-95 ${
                selectedVariations.length > 0
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-black hover:-translate-y-0.5'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              } ${downloading ? 'opacity-80 cursor-wait' : ''}`}
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              הורדה {selectedVariations.length > 0 && `(${selectedVariations.length})`}
            </button>

            <div className="w-px h-8 bg-slate-200 mx-1" />

            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="p-3 rounded-xl border-2 border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 active:scale-95 transition-all group shadow-none"
              title="התנתקות מהמערכת"
            >
              <LogOut className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" dir="rtl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLogoutConfirm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 border-2 border-slate-300 shadow-none"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <LogOut className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-2xl font-black tracking-tight text-slate-900 text-center mb-2">התנתקות מהמערכת</h3>
              <p className="text-slate-500 font-bold text-center mb-8 text-balance">האם אתם בטוחים שברצונכם להתנתק? תצטרכו להזין סיסמה שוב כדי להיכנס.</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="h-12 rounded-2xl border-2 border-slate-200 text-slate-600 font-black uppercase tracking-widest hover:bg-slate-50 active:scale-95 active:bg-slate-100 active:border-slate-400 active:text-slate-900 transition-all shadow-none"
                >
                  ביטול
                </button>
                <button
                  onClick={handleLogout}
                  className="h-12 rounded-2xl bg-red-500 text-white font-black uppercase tracking-widest hover:bg-red-600 active:scale-95 transition-all border-2 border-red-500 shadow-none"
                >
                  התנתקו
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 p-5 bg-red-50 border border-red-200 text-red-600 rounded-2xl text-sm font-bold flex items-center gap-4 shadow-none"
            >
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-balance">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <Loader2 className="w-16 h-16 text-orange-600 animate-spin mb-8" />
            <h2 className="text-2xl font-black tracking-tight mb-3">סורקים פונטים</h2>
            <p className="text-slate-600 text-base font-bold text-balance">{loadingMessage}</p>
          </div>
        )}

        {!fonts.length && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div className="w-28 h-28 rounded-3xl flex items-center justify-center mb-10 border-2 border-slate-300 bg-white text-slate-300 shadow-none">
              <Globe className="w-14 h-14" />
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-3">מוכנים לסריקה</h2>
            <p className="text-slate-600 text-lg max-w-sm mx-auto font-bold text-balance">הזינו כתובת אתר למעלה כדי לחלץ את אוסף הפונטים שלו באופן מיידי.</p>
          </div>
        )}

        {/* Controls Bar */}
        {fonts.length > 0 && (
          <div className="mb-10 flex flex-col md:flex-row gap-4 items-center justify-center">
            <div className="relative w-full max-w-md">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="חפשו פונטים..."
                title="חפשו פונט מתוך הרשימה שנמצאה"
                className="w-full h-11 pr-12 pl-4 rounded-full border-2 border-slate-300 focus:border-orange-600 text-slate-900 placeholder:text-slate-500 transition-all outline-none text-sm font-bold shadow-none"
                value={fontSearchQuery}
                onChange={(e) => setFontSearchQuery(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredFonts.map((group, idx) => (
            <FontCard 
              key={`${group.family}-${idx}`} 
              group={group} 
              selectedVariations={selectedVariations} 
              toggleFamily={toggleFamily}
              referer={lastScannedUrl}
            />
          ))}
        </div>

      </main>
    </div>
  );
}
