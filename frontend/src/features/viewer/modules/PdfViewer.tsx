import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, NumberField, SearchField, Spinner, Text } from '../../../components/ui';
import { useCssVarRef } from '../../../components/ui/_internal/useCssVar';
import { apiClient } from '../../../lib/api/client';
import type { ViewerModuleProps } from '../moduleRegistry';
import { useViewerStore } from '../viewerStore';
import './PdfViewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface TextSpanItem {
  id: string;
  str: string;
  x: number;
  y: number;
  fontSize: number;
}

function PdfTextSpan({ item, highlighted }: { item: TextSpanItem; highlighted: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVarRef(ref, '--pdf-span-x', `${item.x.toFixed(1)}px`);
  useCssVarRef(ref, '--pdf-span-y', `${item.y.toFixed(1)}px`);
  useCssVarRef(ref, '--pdf-span-fs', `${Math.max(4, item.fontSize).toFixed(1)}px`);
  return (
    <span
      ref={ref}
      className="org-pdf__tspan"
      data-match={highlighted ? 'true' : undefined}
    >
      {item.str}
    </span>
  );
}

export function PdfViewer({ file, viewerState, onUpdateState }: ViewerModuleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportBg = useViewerStore((s) => s.viewportBg);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textSpans, setTextSpans] = useState<TextSpanItem[]>([]);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);

  const scale = viewerState.zoom > 0 ? Math.max(0.25, Math.min(4, viewerState.zoom)) : 1.15;

  // Load PDF document and pre-extract text per page for search
  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    async function loadDoc() {
      setLoading(true);
      setError(null);
      try {
        const task = pdfjsLib.getDocument(apiClient.fileContentUrl(file.id));
        loadedDoc = await task.promise;
        if (cancelled) {
          void loadedDoc.destroy();
          return;
        }
        setDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setPageNum(1);

        const texts: string[] = [];
        for (let i = 1; i <= loadedDoc.numPages; i++) {
          const p = await loadedDoc.getPage(i);
          const content = await p.getTextContent();
          const str = content.items
            .map((it) => ('str' in it ? it.str : ''))
            .join(' ');
          texts.push(str);
        }
        if (!cancelled) setPageTexts(texts);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDoc();
    return () => {
      cancelled = true;
      if (loadedDoc) void loadedDoc.destroy();
    };
  }, [file.id]);

  // Render active page + selectable text overlay
  useEffect(() => {
    const activeDoc = doc;
    if (!activeDoc) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function renderPage() {
      if (!activeDoc) return;
      const clampedPage = Math.max(1, Math.min(activeDoc.numPages, pageNum));
      const page = await activeDoc.getPage(clampedPage);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      renderTask = page.render({ canvasContext: ctx, canvas, viewport });
      try {
        await renderTask.promise;
      } catch {
        return;
      }
      if (cancelled) return;

      const content = await page.getTextContent();
      if (cancelled) return;
      const spans: TextSpanItem[] = [];
      content.items.forEach((it, idx) => {
        if (!('str' in it) || !it.str) return;
        const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || 12;
        spans.push({
          id: `${clampedPage}-${idx}`,
          str: it.str,
          x: tx[4],
          y: tx[5] - fontHeight,
          fontSize: fontHeight,
        });
      });
      setTextSpans(spans);
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNum, scale]);

  // Listen to Inspector page/bookmark navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ page?: number }>;
      const target = (custom.detail?.page ?? 0) + 1;
      setPageNum(Math.max(1, Math.min(numPages || 1, target)));
    };
    window.addEventListener('organum:pdf-page', handler);
    return () => window.removeEventListener('organum:pdf-page', handler);
  }, [numPages]);

  const matchingPages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches: number[] = [];
    pageTexts.forEach((txt, idx) => {
      if (txt.toLowerCase().includes(q)) matches.push(idx + 1);
    });
    return matches;
  }, [pageTexts, searchQuery]);

  const qLower = searchQuery.trim().toLowerCase();

  const jumpNextMatch = () => {
    if (matchingPages.length === 0) return;
    const nextIdx = (matchIdx + 1) % matchingPages.length;
    setMatchIdx(nextIdx);
    setPageNum(matchingPages[nextIdx] ?? 1);
  };

  return (
    <div className="org-pdf" data-bg={viewportBg}>
      <div className="org-pdf__bar">
        <Button
          size="sm"
          disabled={pageNum <= 1}
          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
        >
          Prev Page
        </Button>
        <NumberField
          className="org-pdf__page-input"
          mode="int"
          value={pageNum}
          min={1}
          max={Math.max(1, numPages)}
          step={1}
          onChange={(v) => setPageNum(Math.max(1, Math.min(Math.max(1, numPages), Math.round(v))))}
          ariaLabel="PDF page number"
        />
        <Text size="sm" variant="mono">
          / {numPages || '-'}
        </Text>
        <Button
          size="sm"
          disabled={pageNum >= numPages}
          onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
        >
          Next Page
        </Button>

        <Button size="sm" onClick={() => onUpdateState({ zoom: -1 })}>
          Fit
        </Button>
        <Button size="sm" onClick={() => onUpdateState({ zoom: 1 })}>
          100%
        </Button>
        <Button
          size="sm"
          onClick={() => onUpdateState({ zoom: Math.max(0.25, scale / 1.25) })}
          aria-label="Zoom out PDF"
        >
          -
        </Button>
        <Button
          size="sm"
          onClick={() => onUpdateState({ zoom: Math.min(4, scale * 1.25) })}
          aria-label="Zoom in PDF"
        >
          +
        </Button>

        <span className="org-pdf__spacer" />

        <SearchField
          className="org-pdf__search"
          value={searchQuery}
          onChange={(val) => {
            setSearchQuery(val);
            setMatchIdx(0);
            const firstMatch = pageTexts.findIndex((t) =>
              t.toLowerCase().includes(val.trim().toLowerCase()),
            );
            if (val.trim() && firstMatch >= 0) {
              setPageNum(firstMatch + 1);
            }
          }}
          placeholder="Find in PDF..."
          ariaLabel="Search PDF text"
        />
        {searchQuery.trim() !== '' && (
          <>
            <Text size="sm" variant="mono">
              {matchingPages.length} page match{matchingPages.length === 1 ? '' : 'es'}
            </Text>
            <Button size="sm" onClick={jumpNextMatch} disabled={matchingPages.length === 0}>
              Next Match
            </Button>
          </>
        )}
      </div>

      <div className="org-pdf__viewport">
        {error ? (
          <Banner severity="danger" title="PDF Error">
            {error}
          </Banner>
        ) : (
          <div className="org-pdf__stage">
            <canvas ref={canvasRef} className="org-pdf__canvas" aria-label="PDF document page" />
            <div className="org-pdf__textlayer" aria-label="PDF text selection layer">
              {textSpans.map((span) => (
                <PdfTextSpan
                  key={span.id}
                  item={span}
                  highlighted={Boolean(qLower && span.str.toLowerCase().includes(qLower))}
                />
              ))}
            </div>
            {loading && (
              <div className="org-pdf__overlay">
                <Spinner />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
