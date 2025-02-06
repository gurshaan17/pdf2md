const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

class PDFLinkDetector {
  constructor() {
    // Initialize PDFJS worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.js');
  }

  async detectLinks(pdfPath) {
    try {
      // Read PDF file
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      
      // Load PDF document
      const pdfDocument = await pdfjsLib.getDocument({ data }).promise;
      const numPages = pdfDocument.numPages;
      
      // Store all links
      const allLinks = [];

      // Process each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        
        // Get annotations (which include links)
        const annotations = await page.getAnnotations();
        
        // Get text content with positions
        const textContent = await page.getTextContent({
          includeMarkedContent: true
        });
        
        // Get viewport for coordinate transformation
        const viewport = page.getViewport({ scale: 1.0 });
        
        // Process links on this page
        const pageLinks = this.processPageLinks(annotations, textContent, viewport, pageNum);
        allLinks.push(...pageLinks);
      }

      return allLinks;
    } catch (error) {
      throw new Error(`Failed to detect links: ${error.message}`);
    }
  }

  processPageLinks(annotations, textContent, viewport, pageNum) {
    const links = [];
    
    // Process link annotations
    for (const annotation of annotations) {
      // Check if it's a link annotation
      if (annotation.subtype !== 'Link') continue;

      // Transform PDF coordinates to viewport coordinates
      const linkBounds = viewport.convertToViewportRectangle(annotation.rect);
      const [x1, y1, x2, y2] = linkBounds;
      
      // Find text content within link bounds
      const linkedText = this.findTextInBounds(
        textContent.items,
        Math.min(x1, x2), // Ensure correct order of coordinates
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2),
        viewport
      );

      // Only add if we found associated text
      if (linkedText) {
        links.push({
          page: pageNum,
          text: linkedText,
          bounds: linkBounds,
          url: annotation.url || null,
          internal: annotation.dest || null,
          action: annotation.action,
          type: this.getLinkType(annotation)
        });
      }
    }

    return links;
  }

  getLinkType(annotation) {
    if (annotation.url) {
      return 'external';
    } else if (annotation.dest) {
      return 'internal';
    } else if (annotation.action) {
      return `action:${annotation.action.type}`;
    }
    return 'unknown';
  }

  findTextInBounds(textItems, x1, y1, x2, y2, viewport) {
    const matchingItems = [];
    const tolerance = 2; // Small tolerance for boundary matching

    for (const item of textItems) {
      // Get text item bounds
      const itemBounds = viewport.convertToViewportRectangle([
        item.transform[4],
        item.transform[5],
        item.transform[4] + item.width,
        item.transform[5] + item.height
      ]);

      const [itemX1, itemY1, itemX2, itemY2] = itemBounds;

      // Check if text item overlaps with link bounds
      if (
        Math.max(itemX1, x1) <= Math.min(itemX2, x2) + tolerance &&
        Math.max(itemY1, y1) <= Math.min(itemY2, y2) + tolerance
      ) {
        matchingItems.push({
          str: item.str,
          x: itemX1,
          y: itemY1
        });
      }
    }

    // Sort items by position (top to bottom, left to right)
    matchingItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) < tolerance) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    // Combine text from all matching items
    return matchingItems.map(item => item.str).join(' ').trim();
  }
}

module.exports = PDFLinkDetector;