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
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false
      });
  
      // Get annotations for links
      const annotations = await pageData.getAnnotations();
  
      const { text, links } = this.processPageContent(textContent, annotations);
      this.pageTexts.set(pageData.pageNumber, text);
      this.hyperlinks.set(pageData.pageNumber, links);
  
      return text;
    } catch (error) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }
  
  processPageContent(textContent, annotations) {
    let text = '';
    let lastY;
    const links = [];
    const seenLinks = new Set();  // Track unique links
  
    for (const item of textContent.items) {
      const [, , , , x, y] = item.transform;
  
      if (lastY !== undefined && Math.abs(lastY - y) > 5) {
        text += '\n';  // New line when moving to a new row
      }
      text += item.str;
      lastY = y;
  
      annotations.forEach(ann => {
        if (ann.subtype === 'Link' && ann.url && this.isWithinAnnotation(x, y, ann.rect)) {
          if (!seenLinks.has(ann.url)) {
            links.push({ text: item.str, url: ann.url });
            seenLinks.add(ann.url);
          }
        }
      });
    }
    return {
      text,
      links
    };
  }
  
  isWithinAnnotation(x, y, rect) {
    // Check if the (x, y) position falls within the annotation rectangle
    return (
      x >= rect[0] && x <= rect[2] &&
      y >= rect[1] && y <= rect[3]
    );
  }

  combineAdjacentLinks(textItems, rawLinks) {
    const combinedLinks = [];
    let currentLink = null;

    // Sort text items by position (top to bottom, left to right)
    textItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 5) { // Items on same line
        return a.x - b.x;
      }
      return b.y - a.y;
    });

    // Analyze text items for potential link combinations
    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      
      if (item.hasLink) {
        const matchingRawLink = rawLinks.find(link => 
          link.x === item.x && link.y === item.y
        );

        if (!currentLink) {
          currentLink = {
            text: item.text,
            url: matchingRawLink?.url,
            parts: [item]
          };
        } else {
          // Check if this item is adjacent to current link
          const lastPart = currentLink.parts[currentLink.parts.length - 1];
          const isAdjacent = Math.abs(lastPart.y - item.y) < 5 && 
                            Math.abs(lastPart.x + lastPart.width - item.x) < 10;

          if (isAdjacent && matchingRawLink?.url === currentLink.url) {
            currentLink.text += ' ' + item.text;
            currentLink.parts.push(item);
          } else {
            if (currentLink.url) {
              combinedLinks.push({
                text: currentLink.text.trim(),
                url: currentLink.url
              });
            }
            currentLink = {
              text: item.text,
              url: matchingRawLink?.url,
              parts: [item]
            };
          }
        }
      } else if (currentLink) {
        if (currentLink.url) {
          combinedLinks.push({
            text: currentLink.text.trim(),
            url: currentLink.url
          });
        }
        currentLink = null;
      }
    }

    // Add the last link if exists
    if (currentLink && currentLink.url) {
      combinedLinks.push({
        text: currentLink.text.trim(),
        url: currentLink.url
      });
    }

    return combinedLinks;
  }

  async processContent() {
    const pages = Array.from(this.pageTexts.values());
    
    let processedPages = pages.map((page, index) => {
      let processedText = this.processPage(page);
      
      // Insert hyperlinks for this page
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      processedText = this.insertHyperlinks(processedText, pageLinks);
      
      return processedText;
    });
  
    return processedPages.join('\n\n---\n\n');  // Add separator between pages
  }
  
  

  insertHyperlinks(text, links) {
    if (!links.length) return text;
  
    let result = text;
    const addedLinks = new Set();
  
    // Sort links by text length (longer ones first)
    links.sort((a, b) => b.text.length - a.text.length);
  
    links.forEach(link => {
      if (link.text && link.url && !addedLinks.has(link.url)) {
        const escapedText = this.escapeRegExp(link.text.trim());
        const markdownLink = `[${link.text.trim()}](${link.url})`;
  
        const regex = new RegExp(`(?<!\\[|\\]\\()${escapedText}(?!\\]|\\))`, 'g');
        result = result.replace(regex, markdownLink);
  
        addedLinks.add(link.url);
      }
    });
  
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