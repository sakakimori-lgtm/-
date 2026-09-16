import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import { UploadedFile, HistoryRecord, ParsedResult, CriticalItem } from './types';
import { PlusCircle, X, Play, Copy, Download, AlertTriangle, CheckCircle2, FileImage, Sliders, MousePointer2, Trash2, Edit2, ZoomIn, ZoomOut, Maximize, FileSpreadsheet, Settings, Key } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { jsonrepair } from 'jsonrepair';
import * as XLSX from 'xlsx';

interface BubbleNode {
  id: string;
  type: 'dim' | 'crit';
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  label: string;
  data: any;
  originalIndex: number;
}

const repairJSON = (str: string) => {
  let s = str.trim();
  if (s.startsWith('```json')) s = s.substring(7);
  else if (s.startsWith('```')) s = s.substring(3);
  if (s.endsWith('```')) s = s.substring(0, s.length - 3);
  s = s.trim();
  
  try {
    return jsonrepair(s);
  } catch (e) {
    console.error("jsonrepair failed:", e);
    return s;
  }
};

const SummaryCard = ({ type, num, label }: { type: 'critical'|'warn'|'info'|'ok', num: number, label: string }) => {
  const colors = {
    critical: 'before:bg-danger text-danger',
    warn: 'before:bg-warn text-warn',
    info: 'before:bg-accent text-accent',
    ok: 'before:bg-success text-success'
  };
  return (
    <div className={`bg-bg-panel border border-border-main rounded p-4 relative overflow-hidden before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 ${colors[type]}`}>
      <div className={`font-mono text-4xl font-bold leading-none mb-1 ${colors[type].split(' ')[1]}`}>{num}</div>
      <div className="text-[13px] tracking-wider uppercase text-text-muted">{label}</div>
    </div>
  );
};

const Section = ({ title, badge, badgeType, children }: { title: string, badge?: string, badgeType?: string, children: React.ReactNode }) => (
  <div className="mb-5">
    <div className="font-mono text-xs tracking-widest text-text-muted uppercase py-1.5 border-b border-border-main mb-3 flex items-center gap-2 before:content-[''] before:w-[3px] before:h-3.5 before:bg-accent before:inline-block">
      {title}
      {badge && <Badge type={badgeType as any}>{badge}</Badge>}
    </div>
    {children}
  </div>
);

const DataTable = ({ headers, children }: { headers: string[], children: React.ReactNode }) => (
  <table className="w-full border-collapse text-[15px]">
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={i} className="bg-bg-card text-text-muted font-mono text-[10px] tracking-widest uppercase p-2.5 px-3.5 text-left border-b border-border-main font-normal whitespace-nowrap">{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);

const Tr: React.FC<{ children: React.ReactNode, hover?: boolean }> = ({ children, hover }) => (
  <tr className={`border-b border-[#2a3040b3] last:border-none ${hover ? 'hover:bg-accent/5' : ''}`}>
    {children}
  </tr>
);

const Td = ({ children, label, className = '' }: { children: React.ReactNode, label?: boolean, className?: string }) => (
  <td className={`p-3 px-3.5 align-top text-text-main leading-relaxed ${label ? 'font-mono text-xs text-text-muted whitespace-nowrap' : ''} ${className}`}>
    {children}
  </td>
);

const Badge = ({ type, children }: { type: 'critical'|'warn'|'ok'|'info', children: React.ReactNode }) => {
  const styles = {
    critical: 'bg-danger/15 text-danger border-danger/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
    ok: 'bg-success/10 text-success border-success/30',
    info: 'bg-accent/10 text-accent border-accent/25'
  };
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase px-2.5 py-1 rounded font-bold border ${styles[type]}`}>
      {children}
    </span>
  );
};

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('gemini_model') || 'gemini-3.1-pro-preview');
  const [showSettings, setShowSettings] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [mode, setMode] = useState<string>('full');
  const [notes, setNotes] = useState<string>('');
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [activeResult, setActiveResult] = useState<HistoryRecord | null>(null);
  const [tab, setTab] = useState<string>('result');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [scale, setScale] = useState(1);
  const [imageAspect, setImageAspect] = useState<number>(1);
  const [isDownloading, setIsDownloading] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const [bubbleStyle, setBubbleStyle] = useState({
    size: 24,
    fontSize: 11,
    lineThickness: 1.5,
    dimBg: '#2563eb',
    dimBorder: '#ffffff',
    dimText: '#ffffff',
    critBg: '#dc2626',
    critBorder: '#ffffff',
    critText: '#ffffff',
    lineColor: '#2563eb'
  });
  const [activeRightTab, setActiveRightTab] = useState<'warnings' | 'styles'>('warnings');

  const [isAddingBubble, setIsAddingBubble] = useState<'dim' | 'crit' | null>(null);
  const [isExtractingBubble, setIsExtractingBubble] = useState(false);
  const [editingBubble, setEditingBubble] = useState<{ type: 'dim'|'crit', index: number } | null>(null);

  const draggingRef = useRef<{
    id: string;
    type: 'dim' | 'crit';
    index: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    hasMoved: boolean;
    isDragging: boolean;
    isTargetMode?: boolean;
  } | null>(null);
  const [, setDragTick] = useState(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current?.isDragging || !imageContainerRef.current) return;
      
      if (!draggingRef.current.hasMoved) {
        const dx = e.clientX - draggingRef.current.startX;
        const dy = e.clientY - draggingRef.current.startY;
        if (Math.sqrt(dx*dx + dy*dy) > 3) {
          draggingRef.current.hasMoved = true;
        }
      }

      if (draggingRef.current.hasMoved) {
        const rect = imageContainerRef.current.getBoundingClientRect();
        const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
        const y_pct = ((e.clientY - rect.top) / rect.height) * 100;
        draggingRef.current.x = Math.min(Math.max(x_pct, 0), 100);
        draggingRef.current.y = Math.min(Math.max(y_pct, 0), 100);
        setDragTick(t => t + 1);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (draggingRef.current?.isDragging) {
        const dragData = { ...draggingRef.current };
        draggingRef.current = null;
        setDragTick(t => t + 1);

        if (!dragData.hasMoved) {
          if (!dragData.isTargetMode) {
            setEditingBubble({ type: dragData.type, index: dragData.index });
          }
        } else {
          setActiveResult(prev => {
            if (!prev || !prev.parsed) return prev;
            const updatedParsed = { ...prev.parsed };
            if (dragData.type === 'dim') {
              const dims = [...(updatedParsed.dimensions || [])];
              if (dragData.isTargetMode) {
                dims[dragData.index] = { ...dims[dragData.index], x_pct: dragData.x, y_pct: dragData.y };
              } else {
                dims[dragData.index] = { ...dims[dragData.index], bubble_x_pct: dragData.x, bubble_y_pct: dragData.y };
              }
              updatedParsed.dimensions = dims;
            } else {
              const crits = [...(updatedParsed.critical_items || [])];
              if (dragData.isTargetMode) {
                crits[dragData.index] = { ...crits[dragData.index], x_pct: dragData.x, y_pct: dragData.y };
              } else {
                crits[dragData.index] = { ...crits[dragData.index], bubble_x_pct: dragData.x, bubble_y_pct: dragData.y };
              }
              updatedParsed.critical_items = crits;
            }
            
            const newResult = { ...prev, parsed: updatedParsed };
            
            setHistory(prevHistory => {
              const newHistory = prevHistory.map(h => h.id === newResult.id ? newResult : h);
              localStorage.setItem('eda_v3', JSON.stringify(newHistory));
              return newHistory;
            });
            
            return newResult;
          });
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const updateActiveResult = (newParsed: ParsedResult) => {
    if (!activeResult) return;
    const updatedResult = { ...activeResult, parsed: newParsed };
    setActiveResult(updatedResult);
    setHistory(prev => {
      const newHistory = prev.map(h => h.id === updatedResult.id ? updatedResult : h);
      localStorage.setItem('eda_v3', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingBubble || !activeResult?.parsed || isExtractingBubble) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
    const y_pct = ((e.clientY - rect.top) / rect.height) * 100;

    setIsExtractingBubble(true);
    const mode = isAddingBubble;

    try {
      const updatedParsed = { ...activeResult.parsed };
      let newId = 0;
      let newIndex = 0;

      if (mode === 'dim') {
        const dims = updatedParsed.dimensions || [];
        newId = dims.length > 0 ? Math.max(...dims.map((d:any) => Number(d.id) || 0)) + 1 : 1;
        newIndex = dims.length;
        updatedParsed.dimensions = [...dims, {
          id: newId,
          feature: 'AI分析中...',
          value: '...',
          tolerance: '',
          note: '',
          critical: false,
          x_pct,
          y_pct
        }];
        updateActiveResult(updatedParsed);
      } else {
        const crits = updatedParsed.critical_items || [];
        const nextLabel = String.fromCharCode(65 + crits.length);
        newIndex = crits.length;
        updatedParsed.critical_items = [...crits, {
          type: 'AI分析中...',
          description: '正在辨識圖面內容...',
          spec: '',
          severity: 'MEDIUM',
          x_pct,
          y_pct,
          label: nextLabel
        }];
        updateActiveResult(updatedParsed);
      }
      
      // Early clear the adding bubble state so cursor goes back to normal
      setIsAddingBubble(null);

      const fileObj = files.find(f => f.name === activeResult.fileName);
      if (fileObj && fileObj.dataUrl) {
        if (!apiKey) {
          setError("未設定 API Key，無法進行智慧辨識。請點選右上角設定圖示輸入金鑰。");
          return;
        }
        const ai = new GoogleGenAI({ apiKey });
        const base64Data = fileObj.dataUrl.split(',')[1];
        
        const prompt = mode === 'dim' 
          ? `使用者點選了圖面上相對座標大約 (X: ${x_pct.toFixed(2)}%, Y: ${y_pct.toFixed(2)}%) 的位置。請仔細尋找「最貼近」這個點位的單一尺寸標註或幾何公差（GD&T特徵控制框）。
重要提示：
1. 如果點擊位置周圍有「帶數字的圓圈或氣泡（例如藍色泡泡）」，這代表使用者可能點在氣泡附近。此時請務必【順著該氣泡的引線或位置】找到它真正關聯的「尺寸標註」或「幾何公差框」。千萬別把泡泡裡的數字當作標註數值！
2. 極端重要：請注意看圖面上是否有【疊加在一起（上下相連）】的多組幾何公差框！例如：上面第一格是「平面度 (▱ 0.02)」，下面第二格緊連著是「平行度 (// 0.04 B)」。這時候請嚴格根據「氣泡具體在哪一格旁邊」或「使用者點擊座標最接近哪一格的高度」來挑選。例如泡泡9在疊加框的上方，那它只對應最上面的那一格（平面度 0.02）。絕對不要把它們混為一談！
3. 如果你看到幾何公差框，請務必極度嚴謹地辨識最左邊的符號形狀：
   - 一個平行四邊形 (▱) 是「平面度」或「平整度」
   - 兩條平行斜線 (//) 是「平行度」
   - 倒T字型 (⊥) 是「垂直度」
   - 圓圈內有十字 (⌖) 是「位置度」
請回傳單一 JSON (不含 Markdown 或 \`\`\` 標籤)，為了讓你思考更準確，請先在 reasoning 欄位寫下你的觀察過程（例如：我看到泡泡9旁邊有個相連的幾何公差框，上面是平行四邊形0.02，下面是平行度0.04 B，泡泡9較靠近上方，所以我選平面度0.02），然後再填入其他欄位：
{"reasoning": "你的觀察與推論過程...", "feature": "特徵名稱 (請根據你的推論填入中文名稱，如：平面度、平行度、垂直度、直徑、長度等)", "value": "主要數值 (幾何公差請填入框內數值，例如: 0.02, 0.04；一般尺寸則填入數值，如: 25, 4xØ12)", "tolerance": "尺寸公差數值 (若是一般尺寸才填，如: +0.1/0；若是幾何公差，請留空)", "note": "基準面 (Datum) 或是附加符號 (例如 B, A, PCD 等，若無留空)"}`
          : `使用者點選了圖面上相對座標大約 (X: ${x_pct.toFixed(2)}%, Y: ${y_pct.toFixed(2)}%) 的位置。請分析距離這個點位「最精確接近」的特殊指示、註解或警告符號（若有多個，請選最接近的一個）。
請回傳單一 JSON (不含 Markdown 或 \`\`\` 標籤)，包含以下欄位：
{"type": "類型 (例如: 表面粗糙度、焊接符號、一般註解、警告)", "description": "具體說明內容 (例如: Ra 3.2, 塗裝要求等)", "spec": "相關規格代碼 (若無則留空)"}`;

        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: fileObj.file?.type || 'image/jpeg'
                  }
                },
                { text: prompt }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        });

        const resultText = response.text || '';
        try {
           const parsedJson = JSON.parse(jsonrepair(resultText));
           
           setHistory(prevHistory => {
             const hIndex = prevHistory.findIndex(h => h.id === activeResult.id);
             if (hIndex === -1) return prevHistory;
             const resultToUpdate = prevHistory[hIndex];
             if (!resultToUpdate.parsed) return prevHistory;
             
             const finalParsed = { ...resultToUpdate.parsed };
             if (mode === 'dim' && finalParsed.dimensions && finalParsed.dimensions[newIndex]) {
               finalParsed.dimensions = [...finalParsed.dimensions];
               finalParsed.dimensions[newIndex] = {
                 ...finalParsed.dimensions[newIndex],
                 feature: parsedJson.feature || '未辨識',
                 value: parsedJson.value || '-',
                 tolerance: parsedJson.tolerance || '',
                 note: parsedJson.note || ''
               };
             } else if (mode === 'crit' && finalParsed.critical_items && finalParsed.critical_items[newIndex]) {
               finalParsed.critical_items = [...finalParsed.critical_items];
               finalParsed.critical_items[newIndex] = {
                 ...finalParsed.critical_items[newIndex],
                 type: parsedJson.type || '手動警告',
                 description: parsedJson.description || '',
                 spec: parsedJson.spec || ''
               };
             }
             
             const newHistory = [...prevHistory];
             newHistory[hIndex] = { ...resultToUpdate, parsed: finalParsed };
             localStorage.setItem('eda_v3', JSON.stringify(newHistory));
             
             if (activeResult.id === resultToUpdate.id) {
               setActiveResult(newHistory[hIndex]);
             }
             return newHistory;
           });

        } catch (e) {
           console.error("Parse auto-fill error", e);
        }
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err) || '';
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        setError('API 額度已耗盡 (Quota Exceeded)。這通常是因為您使用的 Gemini API Key 在免費方案下，對這個實驗性模型 (gemini-3.1-pro-preview) 的存取受到嚴格限制。如果您是剛申請的免費金鑰，目前可能無法從外部網頁呼叫此模型，請稍後再試，或更換付費方案。');
      } else if (errMsg.includes('404') || errMsg.includes('no longer available')) {
        setError('您選擇的模型目前無法使用 (已下線或無權限存取)。請點擊右上角設定 ⚙️，將模型切換為更新的版本 (例如: gemini-3.6-flash)。');
      } else {
        setError('自動標註擷取時發生錯誤：' + errMsg);
      }
    } finally {
      setIsExtractingBubble(false);
    }
  };

  const bubbleNodes = useMemo(() => {
    const r = activeResult;
    if (!r?.parsed) return [];
    
    const nodes: BubbleNode[] = [];
    const placed: {x: number, y: number}[] = [];
    
    const radiusPct = (bubbleStyle.size / 800) * 100;
    const step = radiusPct * 0.5;

    const getFreePos = (tx: number, ty: number, manualX?: number, manualY?: number) => {
      if (manualX != null && manualY != null) return { x: manualX, y: manualY };

      let cx = tx + radiusPct * 1.5;
      let cy = ty - radiusPct * 1.5 * imageAspect;
      
      const check = (x: number, y: number) => {
         for(const p of placed) {
            const dx = p.x - x;
            const dy = (p.y - y) / imageAspect;
            if (Math.sqrt(dx*dx + dy*dy) < radiusPct * 2.2) return true;
         }
         return false;
      };

      if (!check(cx, cy)) return {x: cx, y: cy};

      const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
      let dist = 0;
      while(dist < 30) {
         dist += step;
         for(const [dx, dy] of dirs) {
            const nx = cx + dx * dist;
            const ny = cy + dy * dist * imageAspect;
            if (nx > 0 && nx < 100 && ny > 0 && ny < 100) {
               if (!check(nx, ny)) return {x: nx, y: ny};
            }
         }
      }
      return {x: cx, y: cy};
    };

    const dims = r.parsed.dimensions || [];
    dims.forEach((d: any, i: number) => {
       if (d.x_pct == null || d.y_pct == null) return;
       const tx = Math.min(Math.max(d.x_pct, 2), 98);
       const ty = Math.min(Math.max(d.y_pct, 2), 98);
       const pos = getFreePos(tx, ty, d.bubble_x_pct, d.bubble_y_pct);
       placed.push(pos);
       nodes.push({
          id: `dim-${i}`, type: 'dim', targetX: tx, targetY: ty, x: pos.x, y: pos.y, label: String(d.id || i+1), data: d, originalIndex: i
       });
    });

    const crits = r.parsed.critical_items || [];
    crits.forEach((c: any, i: number) => {
       if (c.x_pct == null || c.y_pct == null) return;
       const tx = Math.min(Math.max(c.x_pct, 2), 98);
       const ty = Math.min(Math.max(c.y_pct, 2), 98);
       const pos = getFreePos(tx, ty, c.bubble_x_pct, c.bubble_y_pct);
       placed.push(pos);
       nodes.push({
          id: `crit-${i}`, type: 'crit', targetX: tx, targetY: ty, x: pos.x, y: pos.y, label: c.label || String.fromCharCode(65+i), data: c, originalIndex: i
       });
    });

    return nodes;
  }, [activeResult, bubbleStyle.size]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleString('zh-TW'));
    }, 1000);
    try {
      const saved = localStorage.getItem('eda_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        setHistory(parsed);
        if (parsed.length > 0) {
          setActiveResult(parsed[0]);
        }
      }
    } catch (e) {}
    return () => clearInterval(timer);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const addFiles = (fileList: FileList) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/webp', 'application/pdf'];
    Array.from(fileList).forEach(f => {
      if (!allowed.includes(f.type)) return;
      const r = new FileReader();
      r.onload = (e) => {
        if (e.target?.result) {
          setFiles(prev => {
            const newFiles = [...prev, { file: f, dataUrl: e.target!.result as string, name: f.name, size: f.size, type: f.type }];
            if (activeIdx < 0) setActiveIdx(0);
            return newFiles;
          });
        }
      };
      r.readAsDataURL(f);
    });
  };

  const removeFile = (idx: number) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles.splice(idx, 1);
      if (activeIdx >= newFiles.length) setActiveIdx(newFiles.length - 1);
      return newFiles;
    });
  };

  const analyze = async () => {
    const f = files[activeIdx];
    if (!f) return;
    setIsAnalyzing(true);
    setError(null);

    const modes: Record<string, string> = {
      full: '請對這張工程圖面進行完整解析，提取所有可見資訊。請務必將圖面上「所有」的尺寸標註（可能超過 100 個）全部提取出來，絕對不可省略任何一個。',
      dimension: '請專注分析圖面中的尺寸標註與幾何公差（GD&T）。請務必將圖面上「所有」的尺寸標註（可能超過 100 個）全部提取出來，絕對不可省略任何一個。',
      material: '請專注分析圖面中的材料規格、熱處理、表面處理要求。',
      process: '請專注分析圖面中的加工要求、製程注記、機械加工規格。'
    };

    const systemPrompt = `你是一位資深機械工程師與製造品質專家，專門解讀工程圖面。請務必將所有解析結果（包含一般註記 general_notes、備註 note、描述 description 等）翻譯為「繁體中文」後再輸出。

【嚴格規則】
1. 資訊來源：所有資料必須來自圖面可見內容。看不清楚或未標示的欄位填「未標示」。
2. 強制翻譯：圖面上的任何英文說明、註記 (General Notes)、欄位內容，都必須翻譯成「繁體中文」。(專有名詞、材料代號如 ADC12、圖號、尺寸符號、標準代號如 JIS 等保留原文)。
3. 材料代號辨識：鋁合金格式為 A____-T__，第二碼必為數字（1~9），常見如 A6061-T6、A5052-H32；壓鑄鋁為 ADC12；不鏽鋼為 SUS304/316；碳鋼為 S45C/SS400。
4. 數字辨識：注意「6」與「G」、「0」與「O」、「1」與「I」的區別，小數點勿省略。
5. 圖號完整抄錄，不可省略或截斷。
6. 回傳格式：只回傳純 JSON，不可加任何 markdown 標記（不可有 \`\`\`json 或 \`\`\`），不加任何說明文字。請確保 JSON 格式完全合法，字串內的雙引號必須正確跳脫 (escape)。
7. 座標標示 (critical_items)：必須填寫位置座標：x_pct 為該警告特徵在圖面中的水平位置百分比（0=最左, 100=最右），y_pct 為垂直位置百分比（0=最上, 100=最下），精確估計該標注或特徵在圖面上的實際位置。label 為單一大寫字母（A、B、C...依序）。
8. 尺寸座標與編號 (dimensions)：【極度重要，絕對不可省略】這張圖面非常複雜，包含數十甚至上百個尺寸標註。請採取「網格掃描法」，從圖紙左上角開始，由左至右、由上至下，逐一掃描每一個視圖。你必須「毫無遺漏」地提取圖面上「所有」的尺寸標註，無論數量有多少（即使超過 150 個），都必須全部列出。**絕對不可以因為數量太多而中斷或省略**。這是一項嚴格的測試，漏掉任何一個尺寸將導致嚴重後果。dimensions 陣列中的每一個尺寸都必須給予唯一的整數 id (從 1 開始遞增)，並填寫 x_pct 與 y_pct 座標。座標位置請設定在該尺寸文字的「左上角或右下角空白處」，距離尺寸文字至少要有 2% 的距離，**絕對不可以**與尺寸文字重疊，以免影響工程人員閱讀。
9. 一般註記 (general_notes)：【極度重要】圖面上的「註記」、「General Notes」、技術要求、表面處理等整段文字說明（通常位於圖面右上角或右下角），必須「逐字、完整」提取並翻譯為繁體中文，放入 general_notes 陣列中（陣列中每個元素為一條註記），絕對不可遺漏。

回傳 JSON 格式如下：
{"drawing_info":{"part_name":"","part_number":"","supplier_part_number":"","revision":"","scale":"","projection":"","date":"","material":"","mass":"","surface_finish":"","heat_treatment":"","drawn_by":"","designed_by":"","checked_by":"","approved_by":""},"dimensions":[{"id":1,"feature":"","value":"","tolerance":"","note":"","critical":false,"x_pct":50,"y_pct":50}],"tolerances":[{"symbol":"","feature":"","datum":"","value":"","note":"","critical":false}],"materials":[{"item":"","spec":"","standard":"","note":"","critical":false}],"process_requirements":[{"process":"","requirement":"","value":"","note":"","critical":false}],"critical_items":[{"type":"","description":"","spec":"","severity":"HIGH","x_pct":50,"y_pct":50,"label":"A"}],"general_notes":[],"summary":{"total_dimensions":0,"critical_count":0,"warnings":[],"overall_complexity":"MEDIUM"}}`;

    const userPrompt = modes[mode] + (notes ? '\\n\\n額外要求：' + notes : '');

    if (!apiKey) {
      setError("未設定 API Key，無法進行分析。請點選右上角設定圖示輸入您的 Gemini API Key。");
      setIsAnalyzing(false);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const base64Data = f.dataUrl.split(',')[1];
      
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: f.type
            }
          },
          userPrompt
        ],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0,
          topK: 1,
          topP: 0.1,
          seed: 42,
          maxOutputTokens: 8192,
        }
      });

      const rawText = response.text || '';
      let parsed: ParsedResult | null = null;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        console.warn("Initial JSON parse failed, attempting repair...");
        try {
          const repairedText = repairJSON(rawText);
          parsed = JSON.parse(repairedText);
        } catch (repairErr) {
          console.error("Failed to parse JSON even after repair", repairErr);
        }
      }

      const record: HistoryRecord = {
        id: Date.now(),
        fileName: f.name,
        mode,
        timestamp: new Date().toISOString(),
        rawText,
        parsed,
        status: parsed ? 'ok' : 'partial'
      };

      setHistory(prev => {
        const newHistory = [record, ...prev].slice(0, 5);
        localStorage.setItem('eda_v3', JSON.stringify(newHistory));
        return newHistory;
      });
      
      setActiveResult(record);
      setTab('result');

    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err) || '';
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        setError('API 額度已耗盡 (Quota Exceeded)。這通常是因為您使用的 Gemini API Key 在免費方案下，對這個實驗性模型 (gemini-3.1-pro-preview) 的存取受到嚴格限制。如果您是剛申請的免費金鑰，目前可能無法從外部網頁呼叫此模型，請稍後再試，或更換付費方案。');
      } else if (errMsg.includes('404') || errMsg.includes('no longer available')) {
        setError('您選擇的模型目前無法使用 (已下線或無權限存取)。請點擊右上角設定 ⚙️，將模型切換為更新的版本 (例如: gemini-3.6-flash)。');
      } else {
        setError(errMsg || '解析失敗');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyRaw = () => {
    if (!activeResult) return;
    navigator.clipboard.writeText(activeResult.rawText);
  };

  const exportJSON = () => {
    if (!activeResult?.parsed) return;
    const blob = new Blob([JSON.stringify(activeResult.parsed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${Date.now()}.json`;
    a.click();
  };

  const exportExcel = () => {
    if (!activeResult?.parsed) return;
    const p = activeResult.parsed;
    let globalIndex = 1;
    
    // We want a unified structure across all types.
    // Columns: No., 類型 (Type), 特徵/項目 (Feature/Item), 規格/數值 (Spec/Value), 公差 (Tolerance), 備注 (Note), 關鍵 (Critical)
    
    const data: any[] = [];
    
    (p.dimensions || []).forEach(d => {
      data.push({
        'No.': globalIndex++,
        '類型': '尺寸',
        '特徵/項目': d.feature || '',
        '規格/數值': d.value || '',
        '公差': d.tolerance || '',
        '備注': d.note || '',
        '關鍵': d.critical ? '是' : '否'
      });
    });
    
    (p.tolerances || []).forEach(t => {
      data.push({
        'No.': globalIndex++,
        '類型': 'GD&T',
        '特徵/項目': t.feature || '',
        '規格/數值': t.value || '',
        '公差': t.symbol || '', // Put symbol in tolerance column or spec column
        '備注': t.note || '',
        '關鍵': t.critical ? '是' : '否'
      });
    });
    
    (p.materials || []).forEach(m => {
      data.push({
        'No.': globalIndex++,
        '類型': '材料',
        '特徵/項目': m.item || '',
        '規格/數值': m.spec || '',
        '公差': m.standard || '', // Standard
        '備注': m.note || '',
        '關鍵': m.critical ? '是' : '否'
      });
    });
    
    (p.process_requirements || []).forEach(pr => {
      data.push({
        'No.': globalIndex++,
        '類型': '製程',
        '特徵/項目': pr.process || '',
        '規格/數值': pr.value || '',
        '公差': pr.requirement || '', // Requirement
        '備注': pr.note || '',
        '關鍵': pr.critical ? '是' : '否'
      });
    });
    
    (p.general_notes || []).forEach((gn: any) => {
      data.push({
        'No.': globalIndex++,
        '類型': '一般註記',
        '特徵/項目': '註記',
        '規格/數值': gn.description || gn, // depending on structure
        '公差': gn.spec || '',
        '備注': '',
        '關鍵': '否'
      });
    });
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "解析結果");
    
    XLSX.writeFile(wb, `drawing-${Date.now()}.xlsx`);
  };

  const handleDownloadJPG = async () => {
    if (!imageContainerRef.current || isDownloading) return;
    setIsDownloading(true);
    const originalScale = scale;
    setScale(1);
    await new Promise(resolve => setTimeout(resolve, 150)); // Wait for scale reset to render
    try {
      const canvas = await html2canvas(imageContainerRef.current, { 
        useCORS: true, 
        scale: 3, 
        backgroundColor: '#ffffff',
        logging: false
      });
      const link = document.createElement('a');
      link.download = `annotated_drawing_${Date.now()}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.9);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to generate JPG", err);
    } finally {
      setScale(originalScale);
      setIsDownloading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!imageContainerRef.current || isDownloading) return;
    setIsDownloading(true);
    const originalScale = scale;
    setScale(1);
    await new Promise(resolve => setTimeout(resolve, 150)); // Wait for scale reset to render
    try {
      const canvas = await html2canvas(imageContainerRef.current, { 
        useCORS: true, 
        scale: 3, 
        backgroundColor: '#ffffff',
        logging: false
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
      pdf.save(`annotated_drawing_${Date.now()}.pdf`);
    } catch (err) {
      console.error("Failed to generate PDF", err);
    } finally {
      setScale(originalScale);
      setIsDownloading(false);
    }
  };

  const handleExportExcel = () => {
    if (!activeResult?.parsed?.dimensions) return;
    const dims = activeResult.parsed.dimensions.map((d: any, i: number) => ({
      '標號': d.id || i + 1,
      '特徵': d.feature || '',
      '標稱值': d.value || '',
      '公差': d.tolerance || '',
      '備注': d.note || '',
      '狀態': d.critical ? '關鍵' : '一般'
    }));
    
    const ws = XLSX.utils.json_to_sheet(dims);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "尺寸標註");
    XLSX.writeFile(wb, `dimensions_${Date.now()}.xlsx`);
  };

  const buildAnnotationPanel = (r: HistoryRecord, criticals: CriticalItem[]) => {
    const dims = r.parsed?.dimensions || [];
    
    const isPDF = r.fileName.toLowerCase().endsWith('.pdf');
    const fileObj = files.find(f => f.name === r.fileName);
    const hasImage = !!(fileObj && !isPDF);

    if (!hasImage && (!criticals || criticals.length === 0) && (!dims || dims.length === 0)) return null;

    const severityColor = (s?: string) => s === 'HIGH' ? 'bg-danger border-[#000]' : s === 'MEDIUM' ? 'bg-warn border-[#000]' : 'bg-accent border-[#000]';
    const severityLabel = (s?: string) => s === 'HIGH' ? '嚴重' : s === 'MEDIUM' ? '警告' : '注意';
    const severityTextColor = (s?: string) => s === 'HIGH' ? 'text-danger' : s === 'MEDIUM' ? 'text-warn' : 'text-accent';

    return (
      <Section title="圖面警告與尺寸位置標示">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {hasImage && (
            <>
              <button onClick={() => setIsAddingBubble(isAddingBubble === 'dim' ? null : 'dim')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors text-sm font-medium ${isAddingBubble === 'dim' ? 'bg-blue-600 text-white' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/40'}`}>
                <MousePointer2 className="w-4 h-4" />
                {isExtractingBubble ? 'AI擷取中...' : isAddingBubble === 'dim' ? '點擊圖面新增...' : '新增尺寸標注'}
              </button>
              <button onClick={() => setIsAddingBubble(isAddingBubble === 'crit' ? null : 'crit')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors text-sm font-medium ${isAddingBubble === 'crit' ? 'bg-red-600 text-white' : 'bg-red-600/20 text-red-400 hover:bg-red-600/40'}`}>
                <MousePointer2 className="w-4 h-4" />
                {isExtractingBubble ? 'AI擷取中...' : isAddingBubble === 'crit' ? '點擊圖面新增...' : '新增警告標注'}
              </button>
              <div className="w-px h-6 bg-border-main mx-1"></div>
              <button onClick={() => setScale(s => Math.min(s + 0.5, 5))} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border-main text-text-main rounded hover:border-accent hover:text-accent transition-colors text-sm font-medium">
                <ZoomIn className="w-4 h-4" />
                放大
              </button>
              <button onClick={() => setScale(s => Math.max(s - 0.5, 0.5))} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border-main text-text-main rounded hover:border-accent hover:text-accent transition-colors text-sm font-medium">
                <ZoomOut className="w-4 h-4" />
                縮小
              </button>
              <button onClick={() => setScale(1)} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border-main text-text-main rounded hover:border-accent hover:text-accent transition-colors text-sm font-medium">
                <Maximize className="w-4 h-4" />
                適應大小
              </button>
              <div className="w-px h-6 bg-border-main mx-1"></div>
              <div className="flex items-center gap-2 px-2">
                <span className="text-sm font-medium text-text-muted">泡泡大小</span>
                <input 
                  type="range" 
                  min="16" max="64" 
                  value={bubbleStyle.size} 
                  onChange={(e) => setBubbleStyle(s => ({ ...s, size: Number(e.target.value) }))} 
                  className="w-20 accent-accent"
                />
              </div>
              <div className="w-px h-6 bg-border-main mx-1"></div>
              <div className="flex items-center gap-2 px-2">
                <span className="text-sm font-medium text-text-muted">字體大小</span>
                <input 
                  type="range" 
                  min="8" max="48" 
                  value={bubbleStyle.fontSize} 
                  onChange={(e) => setBubbleStyle(s => ({ ...s, fontSize: Number(e.target.value) }))} 
                  className="w-20 accent-accent"
                />
              </div>
              <div className="w-px h-6 bg-border-main mx-1"></div>
              <button onClick={handleDownloadJPG} disabled={isDownloading} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/40 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                <FileImage className="w-4 h-4" />
                {isDownloading ? '處理中...' : '下載 JPG'}
              </button>
              <button onClick={handleDownloadPDF} disabled={isDownloading} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 text-red-400 rounded hover:bg-red-600/40 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" />
                {isDownloading ? '處理中...' : '下載 PDF'}
              </button>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 mb-6 items-start">
          {hasImage ? (
            <div className="relative bg-[#fff] border border-border-main rounded overflow-auto leading-none max-h-[75vh]">
              <div 
                ref={imageContainerRef} 
                className={`relative origin-top-left ${isAddingBubble ? 'cursor-crosshair' : ''}`} 
                style={{ width: `${scale * 100}%` }}
                onClick={handleImageClick}
              >
                <img 
                  src={fileObj.dataUrl} 
                  alt="工程圖面" 
                  className="w-full block pointer-events-none" 
                  onLoad={(e) => setImageAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                />
                
                {/* SVG Leader Lines */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                  {bubbleNodes.map(n => {
                    const isDraggingBubble = draggingRef.current?.id === n.id && !draggingRef.current?.isTargetMode;
                    const isDraggingTarget = draggingRef.current?.id === n.id && draggingRef.current?.isTargetMode;
                    const displayX = isDraggingBubble ? draggingRef.current!.x : n.x;
                    const displayY = isDraggingBubble ? draggingRef.current!.y : n.y;
                    const displayTargetX = isDraggingTarget ? draggingRef.current!.x : n.targetX;
                    const displayTargetY = isDraggingTarget ? draggingRef.current!.y : n.targetY;
                    return (
                      <g key={`line-${n.id}`}>
                        <line 
                          x1={`${displayTargetX}%`} 
                          y1={`${displayTargetY}%`} 
                          x2={`${displayX}%`} 
                          y2={`${displayY}%`} 
                          stroke={bubbleStyle.lineColor} 
                          strokeWidth={bubbleStyle.lineThickness}
                          strokeDasharray={n.type === 'crit' ? "4 2" : ""}
                        />
                        <circle 
                          cx={`${displayTargetX}%`} 
                          cy={`${displayTargetY}%`} 
                          r={Math.max(bubbleStyle.lineThickness * 2.5, 4)} 
                          fill={bubbleStyle.lineColor} 
                          className="pointer-events-auto hover:opacity-80 transition-opacity"
                          style={{ cursor: isDraggingTarget ? 'grabbing' : 'grab' }}
                          onMouseDown={(e) => {
                            if (isAddingBubble) return;
                            e.stopPropagation();
                            e.preventDefault();
                            draggingRef.current = {
                              id: n.id,
                              type: n.type,
                              index: n.originalIndex,
                              x: n.targetX,
                              y: n.targetY,
                              startX: e.clientX,
                              startY: e.clientY,
                              hasMoved: false,
                              isDragging: true,
                              isTargetMode: true
                            };
                            setDragTick(t => t + 1);
                          }}
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* Bubbles */}
                {bubbleNodes.map(n => {
                  const isDim = n.type === 'dim';
                  const bg = isDim ? bubbleStyle.dimBg : bubbleStyle.critBg;
                  const border = isDim ? bubbleStyle.dimBorder : bubbleStyle.critBorder;
                  const color = isDim ? bubbleStyle.dimText : bubbleStyle.critText;
                  
                  const isDraggingBubble = draggingRef.current?.id === n.id && !draggingRef.current?.isTargetMode;
                  const displayX = isDraggingBubble ? draggingRef.current!.x : n.x;
                  const displayY = isDraggingBubble ? draggingRef.current!.y : n.y;
                  
                  const s2 = bubbleStyle.size / 2;
                  const rectSide = (bubbleStyle.size - 3) * 0.7071;

                  return (
                    <div 
                      key={n.id} 
                      className={`absolute pointer-events-auto z-10 group ${isDraggingBubble ? 'cursor-grabbing z-[60]' : 'cursor-grab hover:z-50'}`}
                      style={{ 
                        left: `${displayX}%`, 
                        top: `${displayY}%`,
                        marginLeft: `-${bubbleStyle.size / 2}px`,
                        marginTop: `-${bubbleStyle.size / 2}px`,
                        width: `${bubbleStyle.size}px`,
                        height: `${bubbleStyle.size}px`,
                      }}
                      onMouseDown={(e) => {
                        if (isAddingBubble) return;
                        e.stopPropagation();
                        e.preventDefault();
                        draggingRef.current = {
                          id: n.id,
                          type: n.type,
                          index: n.originalIndex,
                          x: n.x,
                          y: n.y,
                          startX: e.clientX,
                          startY: e.clientY,
                          hasMoved: false,
                          isDragging: true,
                          isTargetMode: false
                        };
                        setDragTick(t => t + 1);
                      }}
                    >
                      {/* SVG Visual */}
                      <svg 
                        className="absolute inset-0 pointer-events-none transition-transform group-hover:scale-125 overflow-visible z-10"
                        width={bubbleStyle.size}
                        height={bubbleStyle.size}
                        viewBox={`0 0 ${bubbleStyle.size} ${bubbleStyle.size}`}
                      >
                        {isDim ? (
                          <circle 
                            cx={s2} 
                            cy={s2} 
                            r={Math.max(s2 - 1.5, 1)} 
                            fill={bg} 
                            stroke={border} 
                            strokeWidth="1.5" 
                          />
                        ) : (
                          <rect 
                            x={s2 - rectSide / 2} 
                            y={s2 - rectSide / 2} 
                            width={Math.max(rectSide, 1)} 
                            height={Math.max(rectSide, 1)} 
                            fill={bg} 
                            stroke={border} 
                            strokeWidth="1.5"
                            transform={`rotate(45 ${s2} ${s2})`}
                          />
                        )}
                        <text 
                          x={s2} 
                          y={s2} 
                          textAnchor="middle" 
                          fill={color} 
                          fontSize={bubbleStyle.fontSize} 
                          fontWeight="bold" 
                          fontFamily="monospace"
                          dy="0.35em"
                        >
                          {n.label}
                        </text>
                      </svg>
                      
                      <div className={`absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-bg-main border border-border-main rounded py-2 px-3 min-w-[180px] max-w-[260px] pointer-events-none transition-opacity whitespace-normal z-20 ${isDraggingBubble ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isDim ? (
                          <>
                            <div className="text-sm font-bold text-text-main mb-1">尺寸標註 #{n.label}</div>
                            <div className="text-xs text-text-muted">特徵: {n.data.feature}</div>
                            <div className="text-xs text-text-muted">數值: {n.data.value} {n.data.tolerance}</div>
                            {n.data.note && <div className="text-xs text-text-muted mt-1">備註: {n.data.note}</div>}
                          </>
                        ) : (
                          <>
                            <div className="text-[13px] font-bold text-danger mb-1">{n.data.type}</div>
                            <div className="font-mono text-[10px] text-text-muted leading-relaxed">
                              {n.data.description}
                              {n.data.spec && <><br/>規格：{n.data.spec}</>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isPDF ? (
            <div className="bg-bg-card border border-border-main rounded p-4 text-center font-mono text-xs text-text-muted leading-loose">
              📄 PDF 圖面無法直接顯示預覽<br/>
              請對照下方警告清單，在原始圖面中確認標示位置<br/>
              <span className="text-accent">建議上傳 JPG/PNG 格式以啟用圖面標注功能</span>
            </div>
          ) : (
            <div className="bg-bg-card border border-border-main rounded p-4 text-center font-mono text-xs text-text-muted leading-loose">
              ⚠️ 原始圖面暫存已清除（可能因頁面重新載入）<br/>
              請重新上傳 <span className="text-accent font-bold">{r.fileName}</span> 以檢視標示位置
            </div>
          )}

          <div className="bg-bg-panel border border-border-main rounded p-4 flex flex-col gap-2.5">
            <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase border-b border-border-main pb-1.5 mb-1">// 警告清單</div>
            {(!criticals || criticals.length === 0) && (
              <div className="text-xs text-text-muted py-4 text-center">無警告項目</div>
            )}
            {criticals.map((c, i) => {
              const label = c.label || String.fromCharCode(65 + i);
              return (
                <div key={i} className="flex items-start gap-2.5 p-2 px-2.5 rounded border border-transparent cursor-pointer transition-all hover:border-border-main hover:bg-bg-card">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-[11px] text-black shrink-0 border-2 border-black/30 ${severityColor(c.severity)}`}>
                    {label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-text-main">
                      {c.type} · <span className={severityTextColor(c.severity)}>{severityLabel(c.severity)}</span>
                    </div>
                    <div className="font-mono text-[10px] text-text-muted mt-0.5 leading-relaxed">
                      {c.description}{c.spec ? ' · ' + c.spec : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Section>
    );
  };

  const renderContent = () => {
    if (tab === 'raw') {
      return (
        <>
          <div className="font-mono text-xs tracking-widest text-text-muted uppercase py-1.5 border-b border-border-main mb-3 flex items-center gap-2 before:content-[''] before:w-[3px] before:h-3.5 before:bg-accent before:inline-block">
            原始 AI 輸出
          </div>
          <div className="bg-bg-panel border border-border-main rounded p-5 font-mono text-xs leading-loose text-text-main whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto">
            {activeResult?.rawText || '尚無資料'}
          </div>
        </>
      );
    }

    if (tab === 'history') {
      if (history.length === 0) {
        return (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-text-dark min-h-[400px]">
            <div className="font-mono text-xs tracking-widest text-center leading-loose">尚無解析記錄</div>
          </div>
        );
      }
      return (
        <>
          <div className="font-mono text-xs tracking-widest text-text-muted uppercase py-1.5 border-b border-border-main mb-3 flex items-center gap-2 before:content-[''] before:w-[3px] before:h-3.5 before:bg-accent before:inline-block">
            解析歷史記錄
          </div>
          <div className="flex flex-col gap-1.5">
            {history.map(h => (
              <div key={h.id} className="bg-bg-card border border-border-main rounded p-2.5 flex items-center gap-3 cursor-pointer hover:border-accent transition-colors" onClick={() => { setActiveResult(h); setTab('result'); }}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${h.status === 'ok' ? 'bg-success' : 'bg-warn'}`}></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-main truncate">{h.fileName}</div>
                  <div className="font-mono text-[10px] text-text-muted mt-0.5">{new Date(h.timestamp).toLocaleString('zh-TW')} · {h.mode.toUpperCase()}</div>
                </div>
                <Badge type={h.status === 'ok' ? 'ok' : 'warn'}>{h.status.toUpperCase()}</Badge>
              </div>
            ))}
          </div>
        </>
      );
    }

    const r = activeResult;
    if (!r) return null;
    const p = r.parsed;

    if (!p) {
      return (
        <>
          <div className="bg-danger/10 border border-danger/30 rounded p-5 flex items-start gap-4 mb-6">
            <AlertTriangle className="text-danger shrink-0 mt-0.5" size={24} />
            <div>
              <div className="font-bold text-danger mb-1 tracking-wide text-[15px]">JSON 解析失敗，顯示原始輸出</div>
              <div className="font-mono text-xs text-text-muted leading-relaxed">AI 回傳格式異常，請切換到「原始輸出」tab 確認內容，或重新解析一次。</div>
            </div>
          </div>
          <div className="bg-bg-panel border border-border-main rounded p-5 font-mono text-xs leading-loose text-text-main whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto">
            {r.rawText}
          </div>
        </>
      );
    }

    const d = p.drawing_info || {};
    const criticals = p.critical_items || [];
    const dims = p.dimensions || [];
    const tols = p.tolerances || [];
    const mats = p.materials || [];
    const procs = p.process_requirements || [];
    const notes = p.general_notes || [];
    const summ = p.summary || {};
    const high = criticals.filter(c => c.severity === 'HIGH').length;
    const med = criticals.filter(c => c.severity === 'MEDIUM').length;

    return (
      <>
        <div className="flex items-center gap-4 mb-6 pb-3 border-b border-border-main flex-wrap">
          <div>
            <div className="text-xl font-bold tracking-wide text-text-main uppercase">{d.part_name || r.fileName}</div>
            <div className="font-mono text-xs text-text-muted mt-1">圖號：{d.part_number || '—'} · 版次：{d.revision || '—'} · {new Date(r.timestamp).toLocaleString('zh-TW')}</div>
          </div>
          <span className={`ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase px-2.5 py-1 rounded font-bold ${summ.overall_complexity === 'HIGH' ? 'bg-danger/15 text-danger border border-danger/30' : summ.overall_complexity === 'LOW' ? 'bg-success/10 text-success border border-success/30' : 'bg-warn/15 text-warn border border-warn/30'}`}>
            {summ.overall_complexity || 'MEDIUM'} COMPLEXITY
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <SummaryCard type="critical" num={high} label="嚴重警告" />
          <SummaryCard type="warn" num={med} label="需注意項目" />
          <SummaryCard type="info" num={dims.length} label="尺寸標註" />
          <SummaryCard type="ok" num={tols.length + procs.length} label="公差 + 製程" />
        </div>

        {buildAnnotationPanel(r, criticals)}

        <Section title="圖面基本資訊">
          <table className="w-full border-collapse text-[15px]">
            <colgroup><col className="w-[120px]"/><col/><col className="w-[120px]"/><col/></colgroup>
            <tbody>
              <Tr>
                <Td label>零件名稱</Td><Td>{d.part_name || '—'}</Td>
                <Td label>圖號</Td><Td className="font-mono">{d.part_number || '—'}</Td>
              </Tr>
              {d.supplier_part_number ? (
                <Tr>
                  <Td label>供應商圖號</Td><Td className="font-mono">{d.supplier_part_number}</Td>
                  <Td label>版次</Td><Td>{d.revision || '—'}</Td>
                </Tr>
              ) : (
                <Tr>
                  <Td label>版次</Td><Td>{d.revision || '—'}</Td>
                  <Td label>比例</Td><Td>{d.scale || '—'}</Td>
                </Tr>
              )}
              <Tr>
                <Td label>材料</Td><Td className="text-success font-bold">{d.material || '—'}</Td>
                <Td label>重量</Td><Td className={d.mass && d.mass !== '未標示' ? 'text-accent font-bold font-mono' : ''}>{d.mass || '—'}</Td>
              </Tr>
              <Tr>
                <Td label>表面粗糙度</Td><Td>{d.surface_finish || '—'}</Td>
                <Td label>熱處理</Td><Td>{d.heat_treatment || '—'}</Td>
              </Tr>
              <Tr>
                <Td label>投影法</Td><Td>{d.projection || '—'}</Td>
                <Td label>日期</Td><Td>{d.date || '—'}</Td>
              </Tr>
              {(d.drawn_by || d.designed_by) && (
                <Tr>
                  <Td label>繪圖</Td><Td>{d.drawn_by || '—'}</Td>
                  <Td label>設計</Td><Td>{d.designed_by || '—'}</Td>
                </Tr>
              )}
              {(d.checked_by || d.approved_by) && (
                <Tr>
                  <Td label>審核</Td><Td>{d.checked_by || '—'}</Td>
                  <Td label>批准</Td><Td>{d.approved_by || '—'}</Td>
                </Tr>
              )}
            </tbody>
          </table>
        </Section>

        {criticals.length > 0 && (
          <Section title={`關鍵注意事項`} badge={`${criticals.length} ITEMS`} badgeType="critical">
            {criticals.map((c, i) => (
              <div key={i} className="bg-danger/5 border border-danger/25 border-l-[3px] border-l-danger rounded p-3.5 mb-2 flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rotate-45 bg-red-600 text-white text-xs font-bold border border-white">
                    <span className="-rotate-45">{c.label || String.fromCharCode(65+i)}</span>
                  </span>
                </div>
                <div>
                  <div className="text-[15px] font-bold text-danger tracking-wide mb-1 flex items-center gap-2">
                    {c.type}
                    <span className={`font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 rounded font-bold ${c.severity === 'HIGH' ? 'bg-danger/15 text-danger border border-danger/30' : c.severity === 'MEDIUM' ? 'bg-warn/15 text-warn border border-warn/30' : 'bg-accent/15 text-accent border border-accent/30'}`}>{c.severity}</span>
                  </div>
                  <div className="font-mono text-xs text-text-muted leading-relaxed">
                    {c.description}
                    {c.spec && <><br/>規格：{c.spec}</>}
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {dims.length > 0 && (
          <Section title="尺寸標註">
            <div className="flex justify-end mb-3">
              <button onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 text-green-500 rounded hover:bg-green-600/40 transition-colors text-sm font-medium">
                <FileSpreadsheet className="w-4 h-4" />
                匯出 Excel (.xlsx)
              </button>
            </div>
            <DataTable headers={['標號', '特徵', '標稱值', '公差', '備注', '狀態']}>
              {dims.map((d, i) => (
                <Tr key={i} hover>
                  <Td>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold border border-white">
                      {d.id || i + 1}
                    </span>
                  </Td>
                  <Td>{d.feature || '—'}</Td>
                  <Td className={d.critical ? 'text-danger font-bold' : ''}>{d.value || '—'}</Td>
                  <Td>{d.tolerance || '—'}</Td>
                  <Td>{d.note || '—'}</Td>
                  <Td>{d.critical ? <Badge type="critical">關鍵</Badge> : <Badge type="ok">一般</Badge>}</Td>
                </Tr>
              ))}
            </DataTable>
          </Section>
        )}

        {tols.length > 0 && (
          <Section title="幾何公差 GD&T">
            <DataTable headers={['符號', '控制特徵', '基準', '公差值', '備注', '狀態']}>
              {tols.map((t, i) => (
                <Tr key={i} hover>
                  <Td className="text-lg">{t.symbol || '—'}</Td>
                  <Td>{t.feature || '—'}</Td>
                  <Td>{t.datum || '—'}</Td>
                  <Td className={t.critical ? 'text-warn' : ''}>{t.value || '—'}</Td>
                  <Td>{t.note || '—'}</Td>
                  <Td>{t.critical ? <Badge type="warn">關鍵</Badge> : <Badge type="ok">一般</Badge>}</Td>
                </Tr>
              ))}
            </DataTable>
          </Section>
        )}

        {mats.length > 0 && (
          <Section title="材料規格">
            <DataTable headers={['項目', '規格', '標準', '備注']}>
              {mats.map((m, i) => (
                <Tr key={i} hover>
                  <Td>{m.item || '—'}</Td>
                  <Td className={m.critical ? 'text-warn' : ''}>{m.spec || '—'}</Td>
                  <Td>{m.standard || '—'}</Td>
                  <Td>{m.note || '—'}</Td>
                </Tr>
              ))}
            </DataTable>
          </Section>
        )}

        {procs.length > 0 && (
          <Section title="製程要求">
            <DataTable headers={['製程', '要求', '規格值', '備注', '狀態']}>
              {procs.map((pr, i) => (
                <Tr key={i} hover>
                  <Td>{pr.process || '—'}</Td>
                  <Td>{pr.requirement || '—'}</Td>
                  <Td className={pr.critical ? 'text-danger font-bold' : ''}>{pr.value || '—'}</Td>
                  <Td>{pr.note || '—'}</Td>
                  <Td>{pr.critical ? <Badge type="critical">關鍵</Badge> : <Badge type="ok">一般</Badge>}</Td>
                </Tr>
              ))}
            </DataTable>
          </Section>
        )}

        {notes.length > 0 && (
          <Section title="一般注記">
            <table className="w-full border-collapse text-[15px]">
              <tbody>
                {notes.map((n, i) => (
                  <Tr key={i} hover>
                    <Td className="w-8 text-text-dark">{i + 1}</Td>
                    <Td>{n}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {summ.warnings && summ.warnings.length > 0 && (
          <Section title="系統警告">
            {summ.warnings.map((w, i) => (
              <div key={i} className="bg-warn/5 border border-warn/25 border-l-[3px] border-l-warn rounded p-3.5 mb-2 flex items-start gap-3">
                <div className="text-base shrink-0 mt-0.5">⚠</div>
                <div>
                  <div className="font-mono text-xs text-text-muted leading-relaxed">{w}</div>
                </div>
              </div>
            ))}
          </Section>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-bg-panel border-b border-border-main px-8 h-16 flex items-center gap-6 sticky top-0 z-50">
        <div className="w-8 h-8 border-2 border-accent flex items-center justify-center shrink-0 relative">
          <div className="w-3.5 h-3.5 bg-accent animate-[pulse_2s_ease-in-out_infinite]" style={{ clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }}></div>
        </div>
        <div className="font-mono text-sm text-accent tracking-widest leading-tight">
          工程圖面解析系統
          <span className="text-text-muted text-xs block">ENGINEERING DRAWING ANALYZER · V3.0</span>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_var(--color-success)] animate-[tblink_2s_infinite]"></div>
            <span className="font-mono text-xs text-text-muted tracking-wider">SYSTEM ONLINE</span>
          </div>
          <span className="font-mono text-xs text-text-dark tracking-wider">{currentTime}</span>
          <button 
            onClick={() => setShowSettings(true)} 
            className="flex items-center justify-center w-8 h-8 rounded border border-border-main hover:border-accent hover:text-accent transition-colors text-text-muted"
            title="設定 API 金鑰"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] flex-1 min-h-[calc(100vh-64px)]">
        <aside className="bg-bg-panel border-r border-border-main flex flex-col">
          <div className="p-3 px-5 border-b border-border-main flex items-center gap-2">
            <span className="font-mono text-xs tracking-widest uppercase text-accent">// 上傳圖面</span>
            <span className="ml-auto font-mono text-[10px] text-text-dark">{files.length} FILES</span>
          </div>

          <div 
            className={`m-4 border border-dashed rounded p-10 text-center cursor-pointer transition-all relative overflow-hidden ${isDragOver ? 'border-accent bg-accent/5' : 'border-border-main hover:border-accent hover:bg-accent/5'}`}
            onDragOver={handleDrop}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" accept="image/*,.pdf" multiple onChange={handleFileInput} />
            <div className="w-12 h-12 mx-auto mb-4 border border-border-main flex items-center justify-center text-text-muted">
              <PlusCircle size={24} strokeWidth={1} />
            </div>
            <div className="text-base font-semibold text-text-main tracking-wide mb-1">拖曳或點擊上傳</div>
            <div className="font-mono text-xs text-text-muted tracking-wider">PNG · JPG · PDF · TIFF</div>
          </div>

          <div className="mx-4 mb-4 flex flex-col gap-2 max-h-[240px] overflow-y-auto pr-1">
            {files.map((f, i) => (
              <div key={i} className={`bg-bg-card border rounded p-2.5 flex items-center gap-3 cursor-pointer transition-colors ${i === activeIdx ? 'border-accent bg-accent/10' : 'border-border-main hover:border-accent'}`} onClick={() => setActiveIdx(i)}>
                <div className="w-10 h-10 object-cover rounded-sm bg-bg-main flex items-center justify-center text-xs text-text-muted shrink-0 overflow-hidden">
                  {f.type === 'application/pdf' ? <span className="text-[10px] text-accent">PDF</span> : <img src={f.dataUrl} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-main truncate">{f.name}</div>
                  <div className="font-mono text-[10px] text-text-muted mt-0.5">{(f.size/1024).toFixed(1)} KB · {f.type.split('/')[1].toUpperCase()}</div>
                </div>
                <button className="bg-transparent border-none text-text-dark hover:text-danger p-1 transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 pb-4">
            <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase mb-2 pb-1.5 border-b border-border-main">分析模式</div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'full', label: '完整解析', sub: 'Full Analysis' },
                { id: 'dimension', label: '尺寸公差', sub: 'GD&T / Tolerance' },
                { id: 'material', label: '材料規格', sub: 'Material Spec' },
                { id: 'process', label: '製程要求', sub: 'Machining / Process' }
              ].map(m => (
                <button key={m.id} className={`bg-bg-card border rounded p-2 text-left transition-all ${mode === m.id ? 'border-accent bg-accent/10' : 'border-border-main hover:border-accent hover:bg-accent/5'}`} onClick={() => setMode(m.id)}>
                  <span className="text-sm font-semibold text-text-main block">{m.label}</span>
                  <span className="font-mono text-[10px] text-text-muted block mt-0.5">{m.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase mb-2 pb-1.5 border-b border-border-main">備註 / 額外指示</div>
            <textarea 
              className="w-full bg-bg-card border border-border-main rounded text-text-main font-mono text-xs p-2.5 resize-none h-18 outline-none transition-colors focus:border-accent placeholder:text-text-dark"
              placeholder="例：重點確認氣孔標準、壓力測試規格..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="px-4 pb-4 mt-auto">
            <button 
              className="w-full p-3.5 bg-accent text-black font-mono text-sm font-bold tracking-widest uppercase rounded flex items-center justify-center gap-2 transition-all hover:bg-[#33d6ff] active:scale-[0.98] disabled:bg-bg-card disabled:text-text-dark disabled:cursor-not-allowed disabled:border disabled:border-border-main disabled:hover:bg-bg-card disabled:active:scale-100"
              disabled={files.length === 0 || isAnalyzing}
              onClick={analyze}
            >
              <Play size={16} fill="currentColor" /> 開始解析
            </button>
          </div>

          <div className="h-px bg-border-main mx-4 my-4"></div>

          <div className="p-3 px-5 border-b border-border-main flex items-center gap-2">
            <span className="font-mono text-xs tracking-widest uppercase text-text-muted">// 解析記錄</span>
            <span className="ml-auto font-mono text-[10px] text-text-dark">{history.length} RECORDS</span>
          </div>

          <div className="flex-1 mx-4 mb-4 overflow-y-auto flex flex-col gap-1.5 pr-1">
            {history.slice(0, 8).map(h => (
              <div key={h.id} className="bg-bg-card border border-border-main rounded p-2.5 flex items-center gap-3 cursor-pointer hover:border-accent transition-colors" onClick={() => { setActiveResult(h); setTab('result'); }}>
                <div className={`w-8 h-8 rounded-sm flex items-center justify-center font-mono text-[10px] text-center leading-tight ${h.status === 'ok' ? 'text-success bg-success/10' : 'text-warn bg-warn/10'}`}>
                  {h.status === 'ok' ? <><CheckCircle2 size={14} className="mb-0.5"/><br/>OK</> : <><AlertTriangle size={14} className="mb-0.5"/><br/>ERR</>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-main truncate">{h.fileName}</div>
                  <div className="font-mono text-[10px] text-text-muted mt-0.5">{new Date(h.timestamp).toLocaleString('zh-TW')}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex flex-col min-w-0">
          <div className="bg-bg-panel border-b border-border-main px-6 py-3 flex items-center gap-4">
            {[
              { id: 'result', label: '解析結果' },
              { id: 'raw', label: '原始輸出' },
              { id: 'history', label: '歷史記錄' }
            ].map(t => (
              <button key={t.id} className={`font-mono text-xs tracking-widest uppercase px-3.5 py-1.5 rounded transition-all ${tab === t.id ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-main'}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              <button className="bg-bg-card border border-border-main rounded text-text-muted font-mono text-[10px] tracking-wider uppercase px-3 py-1.5 transition-colors hover:border-accent hover:text-accent flex items-center gap-1" onClick={copyRaw}>
                <Copy size={12} /> COPY
              </button>
              <button className="bg-bg-card border border-border-main rounded text-text-muted font-mono text-[10px] tracking-wider uppercase px-3 py-1.5 transition-colors hover:border-accent hover:text-accent flex items-center gap-1" onClick={exportExcel}>
                <FileSpreadsheet size={12} /> XLSX
              </button>
              <button className="bg-bg-card border border-border-main rounded text-text-muted font-mono text-[10px] tracking-wider uppercase px-3 py-1.5 transition-colors hover:border-accent hover:text-accent flex items-center gap-1" onClick={exportJSON}>
                <Download size={12} /> JSON
              </button>
            </div>
          </div>

          <main className="p-8 overflow-y-auto min-h-0 flex-1">
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
                <div className="w-[240px] h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_12px_var(--color-accent)] animate-[scan_1.4s_ease-in-out_infinite]"></div>
                <div className="font-mono text-xs text-accent tracking-widest uppercase animate-[tblink_0.8s_ease-in-out_infinite]">正在解析圖面...</div>
                <div className="font-mono text-[10px] text-text-dark tracking-wider">EXTRACTING SPECIFICATIONS · AI PROCESSING</div>
              </div>
            ) : error ? (
              <div className="bg-danger/10 border border-danger/30 rounded p-5 flex items-start gap-4">
                <AlertTriangle className="text-danger shrink-0 mt-0.5" size={24} />
                <div>
                  <div className="font-bold text-danger mb-1 tracking-wide text-[15px]">解析失敗</div>
                  <div className="font-mono text-xs text-text-muted leading-relaxed">{error}</div>
                </div>
              </div>
            ) : !activeResult ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-text-dark min-h-[400px]">
                <div className="grid grid-cols-6 gap-1 opacity-30 mb-4">
                  {Array.from({length: 12}).map((_, i) => (
                    <div key={i} className={`w-7 h-7 border border-border-main ${i % 3 === 2 ? 'bg-accent/5' : ''}`}></div>
                  ))}
                </div>
                <div className="font-mono text-xs tracking-widest text-center leading-loose">
                  上傳工程圖面<br/>系統將自動提取尺寸、公差、材料與製程規格
                </div>
              </div>
            ) : (
              renderContent()
            )}
          </main>
        </div>
      </div>

      {/* Edit Modal */}
      {editingBubble && activeResult?.parsed && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <div className="bg-bg-panel border border-border-main rounded-lg w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border-main flex justify-between items-center bg-bg-card">
              <h3 className="font-bold text-text-main">
                編輯 {editingBubble.type === 'dim' ? '尺寸標注' : '警告標注'}
              </h3>
              <button onClick={() => setEditingBubble(null)} className="text-text-muted hover:text-text-main"><X size={18}/></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {editingBubble.type === 'dim' ? (() => {
                const d = activeResult.parsed!.dimensions![editingBubble.index];
                return (
                  <>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">編號 (ID)</label>
                      <input type="text" defaultValue={d.id} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-dim-id" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">特徵 (Feature)</label>
                      <input type="text" defaultValue={d.feature} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-dim-feature" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">數值 (Value)</label>
                        <input type="text" defaultValue={d.value} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-dim-value" />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">公差 (Tolerance)</label>
                        <input type="text" defaultValue={d.tolerance} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-dim-tolerance" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">備註 (Note)</label>
                      <input type="text" defaultValue={d.note} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-dim-note" />
                    </div>
                  </>
                );
              })() : (() => {
                const c = activeResult.parsed!.critical_items![editingBubble.index];
                return (
                  <>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">代號 (Label)</label>
                      <input type="text" defaultValue={c.label} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-crit-label" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">類型 (Type)</label>
                      <input type="text" defaultValue={c.type} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-crit-type" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">描述 (Description)</label>
                      <textarea defaultValue={c.description} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none min-h-[80px]" id="edit-crit-desc" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">嚴重程度 (Severity)</label>
                      <select defaultValue={c.severity} className="w-full bg-bg-main border border-border-main rounded px-3 py-2 text-sm text-text-main focus:border-accent outline-none" id="edit-crit-severity">
                        <option value="HIGH">嚴重 (HIGH)</option>
                        <option value="MEDIUM">警告 (MEDIUM)</option>
                        <option value="LOW">注意 (LOW)</option>
                      </select>
                    </div>
                  </>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-border-main bg-bg-card flex justify-between items-center">
              <button 
                onClick={() => {
                  const updatedParsed = { ...activeResult.parsed! };
                  if (editingBubble.type === 'dim') {
                    updatedParsed.dimensions = updatedParsed.dimensions!.filter((_, i) => i !== editingBubble.index);
                  } else {
                    updatedParsed.critical_items = updatedParsed.critical_items!.filter((_, i) => i !== editingBubble.index);
                  }
                  updateActiveResult(updatedParsed);
                  setEditingBubble(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-danger hover:bg-danger/10 rounded transition-colors text-sm"
              >
                <Trash2 size={16} /> 刪除
              </button>
              <div className="flex gap-2">
                <button onClick={() => setEditingBubble(null)} className="px-4 py-1.5 text-text-muted hover:text-text-main transition-colors text-sm">取消</button>
                <button 
                  onClick={() => {
                    const updatedParsed = { ...activeResult.parsed! };
                    if (editingBubble.type === 'dim') {
                      const d = updatedParsed.dimensions![editingBubble.index];
                      updatedParsed.dimensions![editingBubble.index] = {
                        ...d,
                        id: (document.getElementById('edit-dim-id') as HTMLInputElement).value,
                        feature: (document.getElementById('edit-dim-feature') as HTMLInputElement).value,
                        value: (document.getElementById('edit-dim-value') as HTMLInputElement).value,
                        tolerance: (document.getElementById('edit-dim-tolerance') as HTMLInputElement).value,
                        note: (document.getElementById('edit-dim-note') as HTMLInputElement).value,
                      };
                    } else {
                      const c = updatedParsed.critical_items![editingBubble.index];
                      updatedParsed.critical_items![editingBubble.index] = {
                        ...c,
                        label: (document.getElementById('edit-crit-label') as HTMLInputElement).value,
                        type: (document.getElementById('edit-crit-type') as HTMLInputElement).value,
                        description: (document.getElementById('edit-crit-desc') as HTMLTextAreaElement).value,
                        severity: (document.getElementById('edit-crit-severity') as HTMLSelectElement).value,
                      };
                    }
                    updateActiveResult(updatedParsed);
                    setEditingBubble(null);
                  }}
                  className="px-4 py-1.5 bg-accent text-white rounded hover:bg-accent/80 transition-colors text-sm font-medium"
                >
                  儲存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-[#000]/60 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-bg-panel border border-border-main rounded w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-accent font-bold font-mono tracking-widest text-lg flex items-center gap-2">
                <Settings className="w-5 h-5" />
                設定
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-text-muted hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Google Gemini API Key</label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input 
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      localStorage.setItem('gemini_api_key', e.target.value);
                    }}
                    placeholder="AIzaSy..."
                    className="w-full bg-bg-main border border-border-main rounded py-2 pl-9 pr-3 text-sm text-text-main focus:outline-none focus:border-accent"
                  />
                </div>
                <p className="text-xs text-text-muted mt-2">
                  您的 API 金鑰僅會儲存於本地瀏覽器中，不會傳送至任何第三方伺服器，確保您的資料安全。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-main mb-1">AI 模型選擇 (Model)</label>
                <select 
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    localStorage.setItem('gemini_model', e.target.value);
                  }}
                  className="w-full bg-bg-main border border-border-main rounded py-2 px-3 text-sm text-text-main focus:outline-none focus:border-accent"
                >
                  <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (最強，需付費 API 方案)</option>
                  <option value="gemini-3.6-pro">gemini-3.6-pro (最新 Pro 模型)</option>
                  <option value="gemini-3.6-flash">gemini-3.6-flash (最新 Flash，速度快，免費額度高)</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro (推薦，優異推理能力)</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash (推薦，速度快，免費額度高)</option>
                </select>
                <p className="text-xs text-text-muted mt-2">
                  如果您看到「API 額度已耗盡」的錯誤，請切換至 flash 結尾的模型（免費額度較高）。
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/80 transition-colors text-sm font-medium"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
