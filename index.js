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
    this.currentPageAnnotations = null;
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      
      const options = {
        pagerender: this.renderPage.bind(this),
        max: 0,
        firstPage: 1
      };

      const pdfData = await pdf(dataBuffer, options);
      const markdown = await this.processContent(pdfData);

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
      // Get both text content and annotations
      const [textContent, annotations] = await Promise.all([
        pageData.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false
        }),
        pageData.getAnnotations()
      ]);

      // Process and store annotations
      this.processAnnotations(annotations, pageData.pageNumber);

      let text = '';
      let lastY;
      let textItems = [];

      // Process text items with position information
      for (let item of textContent.items) {
        if (lastY !== item.transform[5] && text.length > 0) {
          text += '\n';
        }

        // Store text item with position for later link matching
        textItems.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height || 0
        });

        text += item.str;
        lastY = item.transform[5];
      }

      // Match text items with annotations
      this.matchTextWithAnnotations(textItems, pageData.pageNumber);
      
      return text;
    } catch (error) {
      console.error(`Error rendering page: ${error.message}`);
      return '';
    }
  }

  processAnnotations(annotations, pageNumber) {
    const links = [];
    
    for (let annotation of annotations) {
      if (annotation.subtype === 'Link' && annotation.url) {
        links.push({
          url: annotation.url,
          rect: annotation.rect, // [x1, y1, x2, y2]
          pageNumber: pageNumber
        });
      }
    }

    this.hyperlinks.set(pageNumber, links);
  }

  matchTextWithAnnotations(textItems, pageNumber) {
    const links = this.hyperlinks.get(pageNumber) || [];
    const matchedLinks = new Map();

    for (let link of links) {
      const [x1, y1, x2, y2] = link.rect;
      
      // Find all text items that overlap with the link rectangle
      const overlappingText = textItems.filter(item => {
        return (
          item.x >= x1 && 
          item.x <= x2 &&
          item.y >= y1 && 
          item.y <= y2
        );
      });

      if (overlappingText.length > 0) {
        // Combine overlapping text items into a single link
        const linkText = overlappingText
          .sort((a, b) => a.x - b.x)
          .map(item => item.text)
          .join(' ')
          .trim();

        matchedLinks.set(linkText, link.url);
      }
    }

    // Update the hyperlinks map with text-to-URL mappings
    this.hyperlinks.set(pageNumber, Array.from(matchedLinks).map(([text, url]) => ({
      text,
      url
    })));
  }

  async processContent(pdfData) {
    const pages = pdfData.text.split(/\f/).filter(page => page.trim());
    
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

    links.forEach(link => {
      if (link.text && link.url) {
        const markdownLink = `[${link.text}](${link.url})`;
        // Use regex to replace the exact text while preserving case and avoiding nested links
        const regex = new RegExp(
          `(?<!\\[|\\]\\()${this.escapeRegExp(link.text)}(?!\\]|\\))`,'g'
        );
        result = result.replace(regex, markdownLink);
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