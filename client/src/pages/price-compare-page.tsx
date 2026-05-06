import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft, Upload, TrendingUp, TrendingDown, Minus,
  AlertCircle, CheckCircle, Download, RefreshCw, ChevronUp, ChevronDown
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ComparisonRow {
  upc: string;
  name: string;
  registerPrice: number;
  department: string;
  liquorCode: string;
  matched: boolean;
  multipleMatches: boolean;
  michiganPrice: number | null;
  michiganName: string | null;
  michiganBottleSize: string | null;
  michiganLiquorCode: string | null;
  priceDiff: number | null;
  // editable state (added client-side)
  newPrice: number;
  useCustomName: boolean;
  customName: string;
}

type Filter = "all" | "increased" | "decreased" | "same" | "notfound";
type SortKey = "name" | "registerPrice" | "michiganPrice" | "priceDiff" | "newPrice";
type SortDir = "asc" | "desc";

// ── CSV export helpers ────────────────────────────────────────────────────────

function buildPtouchCsv(rows: ComparisonRow[], useCustomNames: boolean): string {
  const headers = [
    "Upc","Department","qty","cents","incltaxes","inclfees","Name","Price","size",
    "ebt","byweight","Fee Multiplier","cost_qty","cost_cents","variable_price",
    "addstock","setstock","pack_name","pack_qty","pack_upc","unit_upc","unit_count",
    "is_oneclick","oc_color","oc_border_color","oc_text_color","oc_fixedpos",
    "oc_page","oc_key","oc_relpos"
  ];

  const dataRows = rows.map(row => {
    const price  = row.newPrice;
    const cents  = Math.round(price * 100);
    const fmtPrice = `$${price.toFixed(2)}`;
    const name   = useCustomNames && row.useCustomName && row.customName.trim()
      ? row.customName.trim()
      : row.name;
    const dept   = useCustomNames ? (row.department === "Liquor" ? "Liquor 2" : row.department) : "Liquor";
    return [
      `"${row.upc}"`, dept, "1", cents.toString(), "n", "n",
      `"${name}"`, fmtPrice, `"${row.liquorCode}"`,
      "", "n", "1", "1", "0", "n", "", `"=""0"""`,
      "", "", "", "", "", "n", "", "", "", "", "", "", ""
    ].join(",");
  });

  return [headers.join(","), ...dataRows].join("\r\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PriceComparePage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows]           = useState<ComparisonRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [fileName, setFileName]   = useState("");
  const [filter, setFilter]       = useState<Filter>("all");
  const [sortKey, setSortKey]     = useState<SortKey>("name");
  const [sortDir, setSortDir]     = useState<SortDir>("asc");
  const [search, setSearch]       = useState("");

  // ── file handling ──────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Wrong file type", description: "Please upload a CSV file." });
      return;
    }
    setFileName(file.name);
    setLoading(true);
    try {
      const csvText = await file.text();
      const res = await fetch("/api/compare-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");

      // Hydrate with client-side editable fields
      const hydrated: ComparisonRow[] = data.rows.map((r: any) => ({
        ...r,
        newPrice:      r.michiganPrice ?? r.registerPrice,
        useCustomName: false,
        customName:    r.name,
      }));
      setRows(hydrated);
      setFilter("all");

      const changed  = hydrated.filter(r => r.priceDiff !== null && r.priceDiff !== 0).length;
      const notFound = hydrated.filter(r => !r.matched).length;
      toast({
        title: "Comparison ready",
        description: `${hydrated.length} products · ${changed} price changes · ${notFound} not found in Michigan DB`,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import failed", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  // ── row editing ────────────────────────────────────────────────────────────

  const updateRow = (idx: number, patch: Partial<ComparisonRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const resetAllToMichigan = () => {
    setRows(prev => prev.map(r => ({
      ...r, newPrice: r.michiganPrice ?? r.registerPrice
    })));
    toast({ title: "Prices reset", description: "All new prices set to Michigan price." });
  };

  // ── sorting ────────────────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── derived data ───────────────────────────────────────────────────────────

  const totalIncreased  = rows.filter(r => r.priceDiff !== null && r.priceDiff > 0).length;
  const totalDecreased  = rows.filter(r => r.priceDiff !== null && r.priceDiff < 0).length;
  const totalSame       = rows.filter(r => r.priceDiff === 0).length;
  const totalNotFound   = rows.filter(r => !r.matched).length;

  const visible = rows
    .filter(r => {
      if (filter === "increased") return r.priceDiff !== null && r.priceDiff > 0;
      if (filter === "decreased") return r.priceDiff !== null && r.priceDiff < 0;
      if (filter === "same")      return r.priceDiff === 0;
      if (filter === "notfound")  return !r.matched;
      return true;
    })
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.upc.includes(q);
    })
    .sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === "name")          { av = a.name;          bv = b.name; }
      else if (sortKey === "registerPrice") { av = a.registerPrice; bv = b.registerPrice; }
      else if (sortKey === "michiganPrice") { av = a.michiganPrice ?? -1; bv = b.michiganPrice ?? -1; }
      else if (sortKey === "priceDiff") { av = a.priceDiff ?? 999; bv = b.priceDiff ?? 999; }
      else { av = a.newPrice; bv = b.newPrice; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1  : -1;
      return 0;
    });

  // Map visible indices back to original row index for editing
  const visibleWithIdx = visible.map(r => ({ row: r, origIdx: rows.indexOf(r) }));

  // ── sub-components ─────────────────────────────────────────────────────────

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;

  const Th = ({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className}`}
    >
      {label}<SortIcon k={k} />
    </th>
  );

  const DiffBadge = ({ diff }: { diff: number | null }) => {
    if (diff === null) return <Badge variant="outline" className="text-xs">No match</Badge>;
    if (diff === 0)    return <Badge variant="secondary" className="text-xs">No change</Badge>;
    if (diff > 0)      return (
      <Badge className="text-xs bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
        <TrendingUp className="h-3 w-3 mr-1" />+${diff.toFixed(2)}
      </Badge>
    );
    return (
      <Badge className="text-xs bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
        <TrendingDown className="h-3 w-3 mr-1" />${diff.toFixed(2)}
      </Badge>
    );
  };

  // ── export ─────────────────────────────────────────────────────────────────

  const doExport = (customNames: boolean) => {
    if (rows.length === 0) return;
    const csv  = buildPtouchCsv(rows, customNames);
    const stem = fileName.replace(/\.csv$/i, "");
    const suffix = customNames ? "_custom_updated" : "_updated";
    downloadCsv(csv, `${stem}${suffix}.csv`);
    toast({ title: "Exported!", description: `Downloaded ${rows.length} products with updated prices.` });
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Price Comparison</h1>
              <p className="text-xs text-muted-foreground">Compare your register prices against Michigan's current price book</p>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={resetAllToMichigan}>
                <RefreshCw className="h-4 w-4 mr-1" /> Reset all to MI price
              </Button>
              <Button variant="outline" size="sm" onClick={() => doExport(false)}>
                <Download className="h-4 w-4 mr-1" /> Export P-touch CSV
              </Button>
              <Button size="sm" onClick={() => doExport(true)}>
                <Download className="h-4 w-4 mr-1" /> Export with Custom Names
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">

        {/* Upload zone (always visible, smaller when results loaded) */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl cursor-pointer transition-all
            ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/30"}
            ${rows.length > 0 ? "p-4" : "p-12"}`}
        >
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
          <div className={`flex items-center gap-3 ${rows.length > 0 ? "justify-start" : "flex-col justify-center text-center"}`}>
            {loading ? (
              <RefreshCw className={`text-primary animate-spin ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
            ) : (
              <Upload className={`text-muted-foreground ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
            )}
            {rows.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {loading ? "Processing…" : <>Drop a new CSV here to replace <strong>{fileName}</strong></>}
              </span>
            ) : (
              <>
                <div>
                  <p className="text-base font-medium text-foreground">
                    {loading ? "Processing your CSV…" : "Drop your register P-touch CSV here"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Upload the file you exported from the scanner — same format as the P-touch CSV export
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Summary strip */}
        {rows.length > 0 && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilter("all")}>
              <CardContent className="py-3 px-4 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xl font-bold">{rows.length}</p>
                  <p className="text-xs text-muted-foreground">Total products</p>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-red-300 transition-colors" onClick={() => setFilter("increased")}>
              <CardContent className="py-3 px-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-red-500" />
                <div>
                  <p className="text-xl font-bold text-red-600">{totalIncreased}</p>
                  <p className="text-xs text-muted-foreground">Price increased</p>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-green-300 transition-colors" onClick={() => setFilter("decreased")}>
              <CardContent className="py-3 px-4 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-xl font-bold text-green-600">{totalDecreased}</p>
                  <p className="text-xs text-muted-foreground">Price decreased</p>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-amber-300 transition-colors" onClick={() => setFilter("notfound")}>
              <CardContent className="py-3 px-4 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-xl font-bold text-amber-600">{totalNotFound}</p>
                  <p className="text-xs text-muted-foreground">Not in MI DB</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filter + search bar */}
        {rows.length > 0 && !loading && (
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["all",       `All (${rows.length})`],
              ["increased", `↑ Up (${totalIncreased})`],
              ["decreased", `↓ Down (${totalDecreased})`],
              ["same",      `— Same (${totalSame})`],
              ["notfound",  `? Not found (${totalNotFound})`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="ml-auto">
              <Input
                placeholder="Search name or UPC…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 w-52 text-sm"
              />
            </div>
          </div>
        )}

        {/* Comparison table */}
        {rows.length > 0 && !loading && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <Th label="Product name"     k="name"          className="min-w-[200px]" />
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">UPC</th>
                    <Th label="Your price"        k="registerPrice" className="text-right" />
                    <Th label="MI price"          k="michiganPrice" className="text-right" />
                    <Th label="Change"            k="priceDiff"     />
                    <Th label="New price"         k="newPrice"      className="text-right" />
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name override</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleWithIdx.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No products match this filter.
                      </td>
                    </tr>
                  )}
                  {visibleWithIdx.map(({ row, origIdx }) => {
                    const rowBg = !row.matched
                      ? "bg-amber-50/40"
                      : row.priceDiff && row.priceDiff > 0
                        ? "bg-red-50/30"
                        : row.priceDiff && row.priceDiff < 0
                          ? "bg-green-50/30"
                          : "";
                    return (
                      <tr key={origIdx} className={`hover:bg-muted/20 transition-colors ${rowBg}`}>
                        {/* Name */}
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-foreground leading-tight">{row.name}</p>
                          {row.michiganName && row.michiganName !== row.name && (
                            <p className="text-xs text-muted-foreground mt-0.5">MI: {row.michiganName}</p>
                          )}
                        </td>
                        {/* UPC */}
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.upc}</td>
                        {/* Your price */}
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          ${row.registerPrice.toFixed(2)}
                        </td>
                        {/* Michigan price */}
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {row.michiganPrice !== null
                            ? <span className="font-medium">${row.michiganPrice.toFixed(2)}</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        {/* Diff badge */}
                        <td className="px-3 py-2.5">
                          <DiffBadge diff={row.priceDiff} />
                        </td>
                        {/* New price — editable */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-muted-foreground text-sm">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.newPrice.toFixed(2)}
                              onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v)) updateRow(origIdx, { newPrice: Math.round(v * 100) / 100 });
                              }}
                              className="w-20 text-right rounded border border-border bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                            />
                            {row.michiganPrice !== null && row.newPrice !== row.michiganPrice && (
                              <button
                                title="Reset to MI price"
                                onClick={() => updateRow(origIdx, { newPrice: row.michiganPrice! })}
                                className="text-muted-foreground hover:text-primary transition-colors ml-0.5"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Name override */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 min-w-[160px]">
                            <input
                              type="checkbox"
                              id={`override-${origIdx}`}
                              checked={row.useCustomName}
                              onChange={e => updateRow(origIdx, { useCustomName: e.target.checked })}
                              className="h-3.5 w-3.5 rounded border-border accent-primary"
                            />
                            {row.useCustomName ? (
                              <input
                                type="text"
                                value={row.customName}
                                onChange={e => updateRow(origIdx, { customName: e.target.value })}
                                className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="Custom name…"
                              />
                            ) : (
                              <label htmlFor={`override-${origIdx}`} className="text-xs text-muted-foreground cursor-pointer">
                                Use custom name
                              </label>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Table footer */}
            <div className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {visibleWithIdx.length} of {rows.length} products</span>
              <div className="flex gap-3">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => doExport(false)}>
                  <Download className="h-3 w-3 mr-1" /> P-touch CSV
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => doExport(true)}>
                  <Download className="h-3 w-3 mr-1" /> P-touch CSV (Custom Names)
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
