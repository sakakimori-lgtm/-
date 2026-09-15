export interface DrawingInfo {
  part_name?: string;
  part_number?: string;
  supplier_part_number?: string;
  revision?: string;
  scale?: string;
  projection?: string;
  date?: string;
  material?: string;
  mass?: string;
  surface_finish?: string;
  heat_treatment?: string;
  drawn_by?: string;
  designed_by?: string;
  checked_by?: string;
  approved_by?: string;
}

export interface Dimension {
  feature?: string;
  value?: string;
  tolerance?: string;
  note?: string;
  critical?: boolean;
}

export interface Tolerance {
  symbol?: string;
  feature?: string;
  datum?: string;
  value?: string;
  note?: string;
  critical?: boolean;
}

export interface Material {
  item?: string;
  spec?: string;
  standard?: string;
  note?: string;
  critical?: boolean;
}

export interface ProcessRequirement {
  process?: string;
  requirement?: string;
  value?: string;
  note?: string;
  critical?: boolean;
}

export interface CriticalItem {
  type?: string;
  description?: string;
  spec?: string;
  severity?: 'HIGH' | 'MEDIUM' | 'LOW';
  x_pct?: number;
  y_pct?: number;
  label?: string;
}

export interface ParsedResult {
  drawing_info?: DrawingInfo;
  dimensions?: Dimension[];
  tolerances?: Tolerance[];
  materials?: Material[];
  process_requirements?: ProcessRequirement[];
  critical_items?: CriticalItem[];
  general_notes?: string[];
  summary?: {
    total_dimensions?: number;
    critical_count?: number;
    warnings?: string[];
    overall_complexity?: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

export interface HistoryRecord {
  id: number;
  fileName: string;
  mode: string;
  timestamp: string;
  rawText: string;
  parsed: ParsedResult | null;
  status: 'ok' | 'partial';
}

export interface UploadedFile {
  file: File;
  dataUrl: string;
  name: string;
  size: number;
  type: string;
}
