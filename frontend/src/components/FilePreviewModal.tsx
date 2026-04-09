import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FilePreviewModalProps {
  fileId: string;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  agentId: string;
  sessionId: string;
  apiUrl: string;
  onClose: () => void;
  onDownload: () => void;
  themeColor?: string;
}

export function FilePreviewModal({
  fileId,
  fileName,
  filePath,
  mimeType,
  agentId,
  sessionId,
  apiUrl,
  onClose,
  onDownload,
  themeColor = '#6366f1'
}: FilePreviewModalProps) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'code'>('rendered');
  
  // PDF state
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Excel state
  const [excelData, setExcelData] = useState<string[][] | null>(null);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  
  // DOCX state
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  
  // PPTX state (fallback for when Office Online isn't available)
  const [pptxSlides, setPptxSlides] = useState<string[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  
  // Image state
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  
  // Office Online viewer state
  const [officeViewerUrl, setOfficeViewerUrl] = useState<string | null>(null);
  const [useOfficeViewer, setUseOfficeViewer] = useState(true);

  // Get file extension from filePath (which has the real filename) not displayName
  const ext = filePath.split('.').pop()?.toLowerCase();

  const isPdfFile = (): boolean => {
    return mimeType === 'application/pdf' || ext === 'pdf';
  };

  const isExcelFile = (): boolean => {
    return mimeType?.includes('spreadsheet') || 
           mimeType?.includes('excel') ||
           ext === 'xlsx' || ext === 'xls';
  };

  const isDocxFile = (): boolean => {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
           ext === 'docx';
  };

  const isPptxFile = (): boolean => {
    return mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
           ext === 'pptx' || ext === 'ppt';
  };

  // Check if file can be viewed with Microsoft Office Online viewer
  const isOfficeFile = (): boolean => {
    return isPptxFile() || isExcelFile() || isDocxFile();
  };

  const isCsvFile = (): boolean => {
    return mimeType === 'text/csv' || ext === 'csv';
  };

  const isTextFile = (): boolean => {
    if (mimeType) {
      return mimeType.startsWith('text/') || 
             mimeType.includes('json') ||
             mimeType.includes('xml') ||
             mimeType.includes('javascript') ||
             mimeType.includes('typescript');
    }
    
    const textExtensions = [
      'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx',
      'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
      'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'yaml', 'yml',
      'toml', 'ini', 'conf', 'config', 'log', 'csv'
    ];
    
    return textExtensions.includes(ext || '');
  };

  const isImageFile = (): boolean => {
    if (mimeType) {
      return mimeType.startsWith('image/');
    }
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    return imageExtensions.includes(ext || '');
  };

  const isBinaryPreviewable = (): boolean => {
    return isPdfFile() || isExcelFile() || isDocxFile() || isPptxFile() || isImageFile();
  };

  useEffect(() => {
    loadContent();
    
    // Cleanup blob URLs
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [fileId]);

  const loadContent = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setOfficeViewerUrl(null);
      
      // For Office files, try to use Microsoft Office Online viewer first
      if (isOfficeFile() && useOfficeViewer) {
        try {
          const signedUrlRes = await fetch(
            `${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/files/${fileId}/signed-url`
          );
          
          if (signedUrlRes.ok) {
            const signedUrlData = await signedUrlRes.json();
            if (signedUrlData.url) {
              // Construct the Microsoft Office Online viewer URL
              const encodedUrl = encodeURIComponent(signedUrlData.url);
              const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;
              setOfficeViewerUrl(officeUrl);
              setIsLoading(false);
              return;
            }
          } else {
            // If signed URL fails, check if we should fall back
            const errorData = await signedUrlRes.json().catch(() => ({}));
            if (errorData.fallback) {
              console.log('[FilePreview] Signed URL not available, falling back to local preview');
            }
          }
        } catch (err) {
          console.log('[FilePreview] Office Online viewer not available, using fallback:', err);
        }
      }
      
      if (isBinaryPreviewable()) {
        // Load binary files using download endpoint
        const res = await fetch(
          `${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/files/${fileId}/download`
        );
        
        if (!res.ok) {
          throw new Error('Failed to load file');
        }
        
        const blob = await res.blob();
        
        if (isImageFile()) {
          const url = URL.createObjectURL(blob);
          setImageUrl(url);
        } else if (isPdfFile()) {
          const url = URL.createObjectURL(blob);
          setPdfUrl(url);
        } else if (isExcelFile()) {
          const arrayBuffer = await blob.arrayBuffer();
          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          setWorkbook(wb);
          setExcelSheets(wb.SheetNames);
          if (wb.SheetNames.length > 0) {
            setCurrentSheet(wb.SheetNames[0]);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
            setExcelData(data as string[][]);
          }
        } else if (isDocxFile()) {
          const arrayBuffer = await blob.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(result.value);
        } else if (isPptxFile()) {
          // Parse PPTX using JSZip
          const arrayBuffer = await blob.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);
          
          // PPTX slides are in ppt/slides/slide1.xml, slide2.xml, etc.
          const slideFiles: { name: string; content: string }[] = [];
          
          // Get all slide files
          const slidePromises: Promise<void>[] = [];
          zip.forEach((relativePath, file) => {
            if (relativePath.match(/^ppt\/slides\/slide\d+\.xml$/)) {
              slidePromises.push(
                file.async('string').then(content => {
                  slideFiles.push({ name: relativePath, content });
                })
              );
            }
          });
          
          await Promise.all(slidePromises);
          
          // Sort slides by number
          slideFiles.sort((a, b) => {
            const numA = parseInt(a.name.match(/slide(\d+)/)?.[1] || '0');
            const numB = parseInt(b.name.match(/slide(\d+)/)?.[1] || '0');
            return numA - numB;
          });
          
          // Extract text from each slide's XML
          const slides = slideFiles.map(slide => {
            // Parse XML and extract text content
            // PPTX text is in <a:t> tags within the XML
            const textMatches = slide.content.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
            const texts = textMatches.map(match => {
              const content = match.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '');
              return content;
            });
            
            // Group text by paragraphs (approximate - look for </a:p> tags)
            let slideText = '';
            let currentParagraph = '';
            
            for (let i = 0; i < texts.length; i++) {
              currentParagraph += texts[i];
              // Check if this text is followed by a paragraph break in the original content
              const textIndex = slide.content.indexOf(`<a:t>${texts[i]}</a:t>`);
              const nextParagraph = slide.content.indexOf('</a:p>', textIndex);
              const nextText = slide.content.indexOf('<a:t>', textIndex + 1);
              
              if (nextParagraph !== -1 && (nextText === -1 || nextParagraph < nextText)) {
                slideText += currentParagraph + '\n\n';
                currentParagraph = '';
              }
            }
            
            if (currentParagraph) {
              slideText += currentParagraph;
            }
            
            return slideText.trim() || '(No text content)';
          });
          
          setPptxSlides(slides);
          setCurrentSlide(0);
        }
      } else {
        // Load text files using content endpoint
        const res = await fetch(
          `${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/files/${fileId}/content`
        );
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to load file');
        }
        
        const data = await res.json();
        setContent(data.content || '');
      }
    } catch (err: any) {
      console.error('Failed to load file content:', err);
      setError(err.message || 'Failed to load file content');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (!workbook) return;
    setCurrentSheet(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    setExcelData(data as string[][]);
  };

  const getLanguageFromFileName = (name: string): string => {
    const fileExt = name.split('.').pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'ps1': 'powershell',
      'sql': 'sql',
      'html': 'html',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'md': 'markdown',
      'dockerfile': 'docker',
      'makefile': 'makefile',
      'txt': 'text',
    };
    
    return languageMap[fileExt || ''] || 'text';
  };

  const parseCsv = (csvContent: string): string[][] => {
    const lines = csvContent.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      
      return values;
    });
  };

  const onPdfLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const renderTable = (data: string[][]) => (
    <div className="overflow-auto border border-[#e2e8f0] rounded-lg">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? 'bg-[#f8fafc] font-semibold sticky top-0' : 'hover:bg-[#f8fafc]'}>
              {row.map((cell, cellIndex) => (
                <td 
                  key={cellIndex}
                  className="border border-[#e2e8f0] px-3 py-2 whitespace-nowrap text-[#1e2a4a]"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-[#e2e8f0] border-t-[#6366f1] rounded-full" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-[#ef4444]">
            <div className="text-4xl mb-2">⚠️</div>
            <p>{error}</p>
            {error.includes('too large') && (
              <p className="text-sm mt-2 text-[#64748b]">
                This file is too large to preview. Please download it instead.
              </p>
            )}
          </div>
        </div>
      );
    }

    // Microsoft Office Online Viewer (PPTX, XLSX, DOCX)
    if (officeViewerUrl) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-2 bg-[#f8fafc] rounded-lg mb-2 border border-[#e2e8f0]">
            <span className="text-xs text-[#64748b] flex items-center gap-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              Powered by Microsoft Office Online
            </span>
            <button
              onClick={() => {
                setUseOfficeViewer(false);
                setOfficeViewerUrl(null);
                loadContent();
              }}
              className="text-xs text-[#3b82f6] hover:underline"
            >
              Use simple preview
            </button>
          </div>
          <div className="flex-1 rounded-lg overflow-hidden border border-[#e2e8f0] bg-white">
            <iframe
              src={officeViewerUrl}
              className="w-full h-full min-h-[500px]"
              frameBorder="0"
              title={`Preview: ${fileName}`}
              allowFullScreen
            />
          </div>
        </div>
      );
    }

    // Image Preview
    if (isImageFile() && imageUrl) {
      return (
        <div className="flex items-center justify-center h-full bg-[#f1f5f9] rounded-lg p-4 overflow-auto">
          <img 
            src={imageUrl} 
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
            style={{ maxHeight: 'calc(90vh - 200px)' }}
          />
        </div>
      );
    }

    // PDF Preview
    if (isPdfFile() && pdfUrl) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-center gap-4 p-2 bg-[#f8fafc] rounded-lg mb-4 border border-[#e2e8f0]">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1 bg-white border border-[#e2e8f0] rounded text-[#1e2a4a] hover:bg-[#f1f5f9] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <span className="text-sm text-[#1e2a4a]">
              Page {currentPage} of {numPages || '?'}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages || p, p + 1))}
              disabled={currentPage >= (numPages || 1)}
              className="px-3 py-1 bg-white border border-[#e2e8f0] rounded text-[#1e2a4a] hover:bg-[#f1f5f9] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
          <div className="flex-1 overflow-auto flex justify-center bg-[#f1f5f9] rounded-lg p-4">
            <Document
              file={pdfUrl}
              onLoadSuccess={onPdfLoadSuccess}
              loading={
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin w-8 h-8 border-2 border-[#e2e8f0] border-t-[#6366f1] rounded-full" />
                </div>
              }
              error={
                <div className="text-[#ef4444] text-center p-8">
                  Failed to load PDF. Try downloading instead.
                </div>
              }
            >
              <Page 
                pageNumber={currentPage} 
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-lg"
              />
            </Document>
          </div>
        </div>
      );
    }

    // Excel Preview
    if (isExcelFile() && excelData) {
      return (
        <div className="flex flex-col h-full">
          {excelSheets.length > 1 && (
            <div className="flex items-center gap-2 p-2 bg-[#f8fafc] rounded-lg mb-4 overflow-x-auto border border-[#e2e8f0]">
              {excelSheets.map(sheet => (
                <button
                  key={sheet}
                  onClick={() => handleSheetChange(sheet)}
                  className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                    currentSheet === sheet 
                      ? 'bg-white border border-[#e2e8f0] font-medium text-[#1e2a4a] shadow-sm' 
                      : 'text-[#64748b] hover:bg-white hover:border hover:border-[#e2e8f0]'
                  }`}
                >
                  {sheet}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {renderTable(excelData)}
          </div>
        </div>
      );
    }

    // DOCX Preview
    if (isDocxFile() && docxHtml) {
      return (
        <div 
          className="prose prose-sm max-w-none p-4 bg-[#f8fafc] rounded-lg overflow-auto border border-[#e2e8f0]"
          dangerouslySetInnerHTML={{ __html: docxHtml }}
        />
      );
    }

    // PPTX Preview
    if (isPptxFile() && pptxSlides.length > 0) {
      return (
        <div className="flex flex-col h-full">
          {/* Slide navigation */}
          <div className="flex items-center justify-between p-3 border-b border-[#e2e8f0] bg-[#f8fafc]">
            <button
              onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
              disabled={currentSlide === 0}
              className="px-3 py-1 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed bg-white border border-[#e2e8f0] hover:bg-[#f1f5f9] transition-colors"
            >
              ← Previous
            </button>
            <span className="text-sm text-[#64748b]">
              Slide {currentSlide + 1} of {pptxSlides.length}
            </span>
            <button
              onClick={() => setCurrentSlide(Math.min(pptxSlides.length - 1, currentSlide + 1))}
              disabled={currentSlide === pptxSlides.length - 1}
              className="px-3 py-1 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed bg-white border border-[#e2e8f0] hover:bg-[#f1f5f9] transition-colors"
            >
              Next →
            </button>
          </div>
          
          {/* Slide content */}
          <div className="flex-1 overflow-auto p-6 bg-white">
            <div className="min-h-[300px] p-6 bg-[#f8fafc] rounded-lg border border-[#e2e8f0] shadow-sm">
              <div className="text-[#1e2a4a] whitespace-pre-wrap text-base leading-relaxed">
                {pptxSlides[currentSlide]}
              </div>
            </div>
          </div>
          
          {/* Slide thumbnails */}
          <div className="p-3 border-t border-[#e2e8f0] bg-[#f8fafc] overflow-x-auto">
            <div className="flex gap-2">
              {pptxSlides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  className={`flex-shrink-0 w-16 h-12 rounded border text-xs font-medium transition-colors ${
                    idx === currentSlide 
                      ? 'border-[#3b82f6] bg-[#eff6ff] text-[#3b82f6]' 
                      : 'border-[#e2e8f0] bg-white text-[#64748b] hover:bg-[#f1f5f9]'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // CSV Preview
    if (isCsvFile()) {
      return renderTable(parseCsv(content));
    }

    // Text file preview
    if (isTextFile()) {
      // Show code view or rendered view based on toggle
      if (ext === 'md' && viewMode === 'rendered') {
        // Render markdown in "view" mode with proper light styling and good contrast
        return (
          <div className="prose prose-slate max-w-none p-6 bg-white">
            <ReactMarkdown
              components={{
                // Custom styling for markdown elements with light theme and proper contrast
                h1: ({children, ...props}) => <h1 className="text-2xl font-bold mb-4 text-slate-900" {...props}>{children}</h1>,
                h2: ({children, ...props}) => <h2 className="text-xl font-semibold mb-3 mt-6 text-slate-900" {...props}>{children}</h2>,
                h3: ({children, ...props}) => <h3 className="text-lg font-semibold mb-2 mt-4 text-slate-800" {...props}>{children}</h3>,
                p: ({children, ...props}) => <p className="mb-4 text-slate-700 leading-relaxed" {...props}>{children}</p>,
                ul: ({children, ...props}) => <ul className="list-disc pl-6 mb-4 space-y-2" {...props}>{children}</ul>,
                ol: ({children, ...props}) => <ol className="list-decimal pl-6 mb-4 space-y-2" {...props}>{children}</ol>,
                li: ({children, ...props}) => <li className="text-slate-700" {...props}>{children}</li>,
                code: ({inline, children, ...props}: any) => 
                  inline 
                    ? <code className="px-1.5 py-0.5 bg-slate-100 text-rose-600 rounded text-sm font-mono border border-slate-200" {...props}>{children}</code>
                    : <code className="block bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm font-mono overflow-x-auto text-slate-800" {...props}>{children}</code>,
                pre: ({children, ...props}) => <pre className="mb-4 bg-slate-50 rounded-lg" {...props}>{children}</pre>,
                blockquote: ({children, ...props}) => <blockquote className="border-l-4 border-slate-300 pl-4 italic text-slate-600 my-4 bg-slate-50 py-2 rounded-r" {...props}>{children}</blockquote>,
                a: ({children, ...props}) => <a className="text-blue-600 hover:text-blue-700 hover:underline" {...props}>{children}</a>,
                strong: ({children, ...props}) => <strong className="font-semibold text-slate-900" {...props}>{children}</strong>,
                em: ({children, ...props}) => <em className="italic text-slate-700" {...props}>{children}</em>,
                hr: (props) => <hr className="my-8 border-t border-slate-200" {...props} />,
                table: ({children, ...props}) => <table className="border-collapse w-full my-4 border border-slate-200 rounded-lg overflow-hidden" {...props}>{children}</table>,
                thead: ({children, ...props}) => <thead className="bg-slate-100" {...props}>{children}</thead>,
                tbody: ({children, ...props}) => <tbody {...props}>{children}</tbody>,
                tr: ({children, ...props}) => <tr className="border-b border-slate-200 hover:bg-slate-50" {...props}>{children}</tr>,
                th: ({children, ...props}) => <th className="px-4 py-2 text-left font-semibold text-slate-900 border-r border-slate-200 last:border-r-0" {...props}>{children}</th>,
                td: ({children, ...props}) => <td className="px-4 py-2 text-slate-700 border-r border-slate-200 last:border-r-0" {...props}>{children}</td>,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        );
      } else {
        // Show code/syntax highlighted view
        return (
          <SyntaxHighlighter
            language={getLanguageFromFileName(fileName)}
            style={oneLight}
            showLineNumbers
            wrapLines
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              backgroundColor: '#fafafa',
              border: '1px solid #e2e8f0',
            }}
          >
            {content}
          </SyntaxHighlighter>
        );
      }
    }

    // Unsupported file type
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-[#64748b]">
          <div className="text-4xl mb-2">📄</div>
          <p className="text-[#1e2a4a]">Preview not available for this file type</p>
          <p className="text-sm mt-2">Please download the file to view it</p>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="h-full w-full bg-white shadow-2xl flex flex-col animate-slide-in-right border-l border-[#e2e8f0]"
    >
      {/* Header */}
      <div className="flex flex-col border-b border-[#e2e8f0] flex-shrink-0">
        <div className="flex items-center justify-between p-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate text-[#1e2a4a]">{fileName}</h3>
            <p className="text-sm text-[#64748b] truncate">{filePath}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={onDownload}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: themeColor, color: '#ffffff' }}
            >
              <svg className="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#f1f5f9] rounded-lg transition-colors text-[#64748b]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* View Toggle - only show for markdown files */}
        {ext === 'md' && (
          <div className="flex items-center gap-1 px-4 pb-3">
            <button
              onClick={() => setViewMode('rendered')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'rendered'
                  ? 'bg-[#f1f5f9] text-[#1e2a4a]'
                  : 'text-[#64748b] hover:bg-[#f8fafc]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'code'
                  ? 'bg-[#f1f5f9] text-[#1e2a4a]'
                  : 'text-[#64748b] hover:bg-[#f8fafc]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Code
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 bg-white">
        {renderContent()}
      </div>
    </div>
  );
}
