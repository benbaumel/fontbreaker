import React, { useState } from "react";
import { Search, Download, Check, Loader2, Globe, Hammer, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";

interface FontVariation {
  family: string;
  url: string;
  format: string;
  weight: string;
  style: string;
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

const FontCard: React.FC<FontCardProps> = ({ group, selectedVariations, toggleFamily, referer }) => {
  const isFamilySelected = group.variations.every(gv => selectedVariations.some(sv => sv.url === gv.url));

  const PREVIEW_EN = "The quick brown fox jumps over the lazy dog";
  const PREVIEW_HE = "דג סקרן שט בים הכללי וצף לו מול חוף מוכר";

  const previewVariation = group.variations.find(v => v.weight === '400') || group.variations[0];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative flex flex-col rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        isFamilySelected 
          ? 'border-orange-600 bg-orange-50/30' 
          : 'border-slate-300 bg-white hover:border-slate-400'
      }`}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between gap-4 border-b border-slate-300">
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-black tracking-tight truncate text-slate-900">
            {group.family}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 bg-slate-200 px-2 py-0.5 rounded-md">
              <span>{group.variations.length} {group.variations.length === 1 ? 'משקל' : 'משקלים'}</span>
              <span className="text-slate-400">•</span>
              <span>{previewVariation.format}</span>
            </div>
          </div>
        </div>
        
        <button
          onClick={() => toggleFamily(group)}
          title={isFamilySelected ? "בטל בחירת משפחה" : "בחר את כל המשקלים במשפחה זו"}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border-2 ${
            isFamilySelected 
              ? 'bg-orange-600 border-orange-600 text-white' 
              : 'bg-white border-slate-400 text-slate-400 hover:border-slate-500 hover:text-slate-600'
          }`}
        >
          <Check className={`w-6 h-6 transition-transform ${isFamilySelected ? 'scale-100' : 'scale-0'}`} />
        </button>
      </div>

      {/* Previews */}
      <div className="px-4 py-4 space-y-2 select-none bg-slate-100/50">
        <div className="space-y-1">
          <div 
            className="text-base leading-tight tracking-wide break-words text-slate-700"
            style={{ 
              fontFamily: `'${group.family}', sans-serif`,
              fontWeight: previewVariation.weight,
              fontStyle: previewVariation.style
            }}
          >
            {PREVIEW_EN}
          </div>

          <div 
            className="text-base leading-tight tracking-wide dir-rtl break-words text-slate-700"
            style={{ 
              fontFamily: `'${group.family}', Arial, sans-serif`,
              fontWeight: previewVariation.weight,
              fontStyle: previewVariation.style
            }}
          >
            {PREVIEW_HE}
          </div>
        </div>

        {/* Variations List */}
        <div className="pt-3 border-t border-slate-300">
          <div className="flex flex-wrap gap-1">
            {group.variations.map((v, idx) => (
              <div 
                key={`${v.url}-${idx}`} 
                className="px-2 py-0.5 rounded-md border border-slate-300 bg-white text-[10px] font-bold uppercase tracking-wider text-slate-700"
              >
                {v.weight} {v.style !== 'normal' && (v.style === 'italic' ? 'נטוי' : v.style)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {group.variations.map((v, idx) => (
        <style key={`style-${v.url}-${idx}`} dangerouslySetInnerHTML={{ __html: `
          @font-face {
            font-family: '${group.family}';
            src: url('/api/proxy-font?url=${encodeURIComponent(v.url)}&referer=${encodeURIComponent(referer)}');
            font-weight: ${v.weight};
            font-style: ${v.style};
            font-display: swap;
          }
        `}} />
      ))}
    </motion.div>
  );
};

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

  const loadingMessages = [
    "מנתח קבצי CSS...",
    "מאתר נתיבי פונטים...",
    "בודק משקלים וסגנונות...",
    "מכין תצוגה מקדימה...",
    "מחלץ פונטים ומשקלים מהאתר..."
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
      toast.success("ברוך הבא! התחברת בהצלחה");
    } else {
      setAuthError(true);
      setPasswordInput("");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
    resetApp();
  };

  const resetApp = () => {
    setUrl("");
    setFonts([]);
    setSelectedVariations([]);
    setError(null);
    setFontSearchQuery("");
    setLoading(false);
  };

  const filteredFonts = fonts
    .filter(f => f.family.toLowerCase().includes(fontSearchQuery.toLowerCase()))
    .sort((a, b) => {
      const urlLower = lastScannedUrl.toLowerCase();
      const aFamilyLower = a.family.toLowerCase();
      const bFamilyLower = b.family.toLowerCase();
      
      // Check if family name (or name without spaces) is in the URL
      // We check for length > 2 to avoid matching very short common strings
      const aInUrl = aFamilyLower.length > 2 && (urlLower.includes(aFamilyLower) || urlLower.includes(aFamilyLower.replace(/\s+/g, '')));
      const bInUrl = bFamilyLower.length > 2 && (urlLower.includes(bFamilyLower) || urlLower.includes(bFamilyLower.replace(/\s+/g, '')));

      if (aInUrl && !bInUrl) return -1;
      if (!aInUrl && bInUrl) return 1;
      
      return b.variations.length - a.variations.length;
    });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-2xl p-10 border-2 border-slate-300 text-center"
        >
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Hammer className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900 mb-2">
            פונט ברייקר
          </h1>
          <p className="text-slate-500 font-bold mb-8">הזן סיסמה כדי להמשיך</p>
          
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                placeholder="סיסמה..."
                className={`w-full h-14 px-6 rounded-2xl border-2 transition-all outline-none text-center font-bold text-lg ${
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
                  className="text-red-500 text-xs font-bold mt-2"
                >
                  סיסמה שגויה, נסה שוב
                </motion.p>
              )}
            </div>
            <button
              type="submit"
              title="התחבר למערכת"
              className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-black transition-all border-2 border-slate-900"
            >
              כניסה
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
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
  };

  const toggleFamily = (group: FontGroup) => {
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
  };

  const handleDownload = async () => {
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
        .replace(/\s+/g, "-")
        .toLowerCase();
      const zipName = `fontbreaker-${familyNames}.zip`;
      
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
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-orange-600/30" dir="rtl">
      <Toaster position="bottom-left" richColors />
      <header className="border-b-2 sticky top-0 z-50 backdrop-blur-md bg-white/95 border-slate-300">
        <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between gap-10">
          <div 
            className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={resetApp}
            title="חזרה לדף הבית ואיפוס החיפוש"
          >
            <div className="w-12 h-12 bg-orange-600 rounded-2xl flex items-center justify-center">
              <Hammer className="text-white w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black tracking-tighter uppercase text-slate-900">
              פונט ברייקר
            </h1>
          </div>

            <button
              onClick={handleLogout}
              className="p-3 rounded-xl border-2 border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all group"
              title="התנתקות מהמערכת"
            >
            <LogOut className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
          
          <form onSubmit={handleScan} className="flex-1 max-w-2xl relative group">
            <Globe className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-orange-600 transition-colors" />
            <input
              type="url"
              placeholder="הדבק כתובת אתר..."
              title="הזן כתובת אתר לסריקה"
              className="w-full h-12 pr-14 pl-28 rounded-full border-2 border-slate-300 focus:border-orange-600 bg-white text-slate-900 placeholder:text-slate-500 transition-all outline-none text-sm font-bold tracking-wide"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              title="סרוק את האתר למציאת פונטים"
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 px-6 bg-orange-600 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-orange-700 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              סרוק
            </button>
          </form>

          <div className="flex items-center gap-4">
            <button
              onClick={handleDownload}
              disabled={selectedVariations.length === 0 || downloading}
              title="הורד את כל הפונטים שנבחרו כקובץ ZIP"
              className={`h-12 px-8 rounded-full font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 border-2 ${
                selectedVariations.length > 0
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-black hover:-translate-y-0.5'
                  : 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed'
              } ${downloading ? 'opacity-80 cursor-wait' : ''}`}
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {downloading ? 'מכין קבצים...' : `הורד ${selectedVariations.length > 0 ? `(${selectedVariations.length})` : ''}`}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 p-5 bg-red-50 border border-red-200 text-red-600 rounded-2xl text-sm font-bold flex items-center gap-4"
            >
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {loading && (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <Loader2 className="w-16 h-16 text-orange-600 animate-spin mb-8" />
            <h2 className="text-2xl font-black tracking-tight mb-3">סורק פונטים</h2>
            <p className="text-slate-600 text-base font-bold">{loadingMessage}</p>
          </div>
        )}

        {!fonts.length && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div className="w-28 h-28 rounded-3xl flex items-center justify-center mb-10 border-2 border-slate-300 bg-white text-slate-300">
              <Globe className="w-14 h-14" />
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-3">מוכן לסריקה</h2>
            <p className="text-slate-600 text-lg max-w-sm mx-auto font-bold">הזן כתובת אתר למעלה כדי לחלץ את אוסף הפונטים שלו באופן מיידי.</p>
          </div>
        )}

        {/* Controls Bar */}
        {fonts.length > 0 && (
          <div className="mb-10 flex flex-col md:flex-row gap-4 items-center justify-center">
            <div className="relative w-full max-w-md">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="חפש פונטים..."
                title="חפש פונט מתוך הרשימה שנמצאה"
                className="w-full h-11 pr-12 pl-4 rounded-full border-2 border-slate-300 focus:border-orange-600 text-slate-900 placeholder:text-slate-500 transition-all outline-none text-sm font-bold"
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
