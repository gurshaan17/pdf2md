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
      // Get text content with enhanced options
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
        includeMarkedContent: true
      });

      // Process the page content
      const processedContent = this.processPageContent(textContent, pageData);
      this.pageTexts.set(pageData.pageNumber, processedContent.text);
      this.hyperlinks.set(pageData.pageNumber, processedContent.links);

      return processedContent.text;
    } catch (error) {
      console.error(`Error rendering page:`, error);
      return '';
    }
  }

  processPageContent(textContent, pageData) {
    const textItems = [];
    const links = [];
    let text = '';
    let lastY;
    let currentLinkParts = null;

    // First pass: collect text items and identify potential link components
    for (let i = 0; i < textContent.items.length; i++) {
      const item = textContent.items[i];
      const [, , , , x, y] = item.transform;

      // Check for link markers in the text
      const isLinkStart = item.str.includes('[') || item.str.includes('http');
      const hasUrl = item.str.includes('http') || item.str.includes('www.') || item.str.includes('.com');
      const nextItem = textContent.items[i + 1];

      // Store item with position and link information
      const textItem = {
        text: item.str,
        x,
        y,
        width: item.width || 0,
        height: item.height || 0,
        isLinkPart: isLinkStart || hasUrl || (currentLinkParts !== null)
      };
      textItems.push(textItem);

      // Handle link detection
      if (isLinkStart && !currentLinkParts) {
        currentLinkParts = {
          text: [],
          url: hasUrl ? item.str : null
        };
      }

      if (currentLinkParts) {
        currentLinkParts.text.push(item.str);
        
        // Try to detect the end of a link
        const isLinkEnd = item.str.includes(']') || 
                         (hasUrl && (!nextItem || Math.abs(nextItem.transform[5] - y) > 5));
        
        if (isLinkEnd) {
          const linkText = currentLinkParts.text.join(' ')
            .replace(/\[|\]/g, '')
            .trim();
          
          // Extract URL if present
          let url = currentLinkParts.url;
          if (!url) {
            const urlMatch = linkText.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
              url = urlMatch[0];
            }
          }

          if (url) {
            links.push({
              text: linkText.replace(url, '').trim() || url,
              url: url
            });
          }
          currentLinkParts = null;
        }
      }

      // Build page text
      if (lastY !== undefined && Math.abs(lastY - y) > 5) {
        text += '\n';
      }
      text += item.str;
      lastY = y;
    }

    return { text, links };
  }

  async processContent(pdfData) {
    const pages = Array.from(this.pageTexts.values());
    
    let processedPages = pages.map((page, index) => {
      let processedText = this.processPage(page);
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      processedText = this.insertHyperlinks(processedText, pageLinks);
      return processedText;
    });

    return processedPages.join('\n\n');
  }

  insertHyperlinks(text, links) {
    if (!links.length) return text;

    let result = text;
    links.sort((a, b) => b.text.length - a.text.length);

    for (const link of links) {
      if (link.text && link.url) {
        // Format the markdown link
        const markdownLink = `[${link.text}](${link.url})`;
        
        // Create regex that matches the link text but not if it's already part of a markdown link
        const escapedText = this.escapeRegExp(link.text);
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