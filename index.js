const fs = require('fs');
const pdf = require('pdf-parse');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor(options = {}) {
    this.options = {
      preserveFormatting: true,
      preserveLinks: true,
      customPageRender: true,
      ...options
    };
    this.hyperlinks = new Map();
    this.pageTexts = new Map();
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      
      // Load the PDF document
      const data = await pdf(dataBuffer, {
        pagerender: this.renderPage.bind(this),
        max: 0,
        firstPage: 1
      });

      const markdown = await this.processContent(data);

      if (outputPath) {
        fs.writeFileSync(sanitize(outputPath), markdown);
      }

      return markdown;
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  async renderPage(pageData) {
    try {
      // Get raw PDF page object for direct access to annotations
      const page = await pageData.getPage();
      
      // Extract text content
      const textContent = await page.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
        includeMarkedContent: true
      });

      // Extract annotations (including links)
      const annotations = await page.getAnnotations();

      // Store page text content for later reference
      let pageText = this.extractPageText(textContent);
      this.pageTexts.set(pageData.pageNumber, pageText);

      // Process clickable elements
      await this.processClickableElements(page, annotations, textContent, pageData.pageNumber);

      return pageText;
    } catch (error) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }

  async processClickableElements(page, annotations, textContent, pageNumber) {
    const links = [];
    const viewport = page.getViewport({ scale: 1.0 });

    for (const annotation of annotations) {
      if (annotation.subtype === 'Link' && (annotation.url || annotation.dest)) {
        try {
          // Get the rectangle coordinates for the link
          const rect = viewport.convertToViewportRectangle(annotation.rect);
          const [x1, y1, x2, y2] = rect;

          // Find text content within the link area
          const linkText = this.findTextInArea(textContent, x1, y1, x2, y2);
          
          if (linkText) {
            links.push({
              text: linkText.trim(),
              url: annotation.url || this.processDestination(annotation.dest),
              rect: rect
            });
          }
        } catch (error) {
          console.error(`Error processing link annotation:`, error);
        }
      }
    }

    // Store the processed links for this page
    this.hyperlinks.set(pageNumber, links);
  }

  findTextInArea(textContent, x1, y1, x2, y2) {
    const textItems = [];
    
    for (const item of textContent.items) {
      const [, , , , itemX, itemY] = item.transform;
      
      // Check if the text item falls within the link rectangle
      // Note: PDF coordinates start from bottom-left, need to adjust Y coordinate
      if (
        itemX >= x1 && 
        itemX <= x2 && 
        itemY >= y1 && 
        itemY <= y2
      ) {
        textItems.push({
          text: item.str,
          x: itemX,
          y: itemY
        });
      }
    }

    // Sort text items by position (left to right, top to bottom)
    textItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 5) { // Items on same line (within 5 units)
        return a.x - b.x;
      }
      return b.y - a.y;
    });

    return textItems.map(item => item.text).join(' ');
  }

  processDestination(dest) {
    // Handle internal PDF destinations (like "#page=5")
    if (Array.isArray(dest)) {
      return `#page=${dest[0]}`;
    }
    return dest;
  }

  extractPageText(textContent) {
    let text = '';
    let lastY;
    
    for (const item of textContent.items) {
      if (lastY !== undefined && lastY !== item.transform[5]) {
        text += '\n';
      }
      text += item.str;
      lastY = item.transform[5];
    }
    
    return text;
  }

  async processContent(pdfData) {
    const pages = Array.from(this.pageTexts.values());
    
    let processedPages = pages.map((page, index) => {
      let processedText = this.processPage(page);
      
      // Insert hyperlinks
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      processedText = this.insertHyperlinks(processedText, pageLinks);
      
      return processedText;
    });

    return processedPages.join('\n\n---\n\n');
  }

  insertHyperlinks(text, links) {
    if (!links.length) return text;

    let result = text;
    // Sort links by text length (descending) to handle nested links correctly
    links.sort((a, b) => b.text.length - a.text.length);

    for (const link of links) {
      if (link.text && link.url) {
        // Escape special regex characters in the link text
        const escapedText = this.escapeRegExp(link.text.trim());
        const markdownLink = `[${link.text.trim()}](${link.url})`;
        
        // Create regex that avoids replacing already processed links
        const regex = new RegExp(
          `(?<!\\[|\\]\\()${escapedText}(?!\\]|\\))`,
          'g'
        );
        
        result = result.replace(regex, markdownLink);
      }
    }

    return result;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  processPage(pageText) {
    let text = pageText
      .replace(/\r\n/g, '\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    text = this.detectAndFormatHeaders(text);
    text = this.detectAndFormatLists(text);
    
    return text;
  }

  detectAndFormatHeaders(text) {
    const lines = text.split('\n');
    const formatted = lines.map((line) => {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) return '';
      
      if (
        (trimmedLine.length < 100 && /^[A-Z][^a-z]{0,3}[A-Z\s\d]{3,}$/.test(trimmedLine)) ||
        (/^[A-Z][\w\s]{2,50}$/.test(trimmedLine) && trimmedLine.toUpperCase() === trimmedLine)
      ) {
        return `# ${trimmedLine}`;
      }
      
      return trimmedLine;
    });

    return formatted.join('\n');
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    let inList = false;
    
    const formatted = lines.map((line) => {
      const trimmedLine = line.trim();
      
      const bulletMatch = trimmedLine.match(/^[-•*]\s+(.+)/);
      const numberMatch = trimmedLine.match(/^(\d+[.)])\s+(.+)/);
      
      if (bulletMatch) {
        inList = true;
        return `- ${bulletMatch[1]}`;
      } else if (numberMatch) {
        inList = true;
        return `${numberMatch[1]} ${numberMatch[2]}`;
      } else if (inList && /^\s+/.test(line)) {
        return line;
      } else {
        inList = false;
        return line;
      }
    });

    return formatted.join('\n');
  }
}

module.exports = PDFToMarkdown;