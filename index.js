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
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false
      });

      let text = '';
      let lastY;
      let links = [];

      for (let item of textContent.items) {
        if (lastY !== item.transform[5] && text.length > 0) {
          text += '\n';
        }

        text += item.str;
        lastY = item.transform[5];

        // Check if the item has a URL and store it
        if (item.hasOwnProperty('url')) {
          links.push({
            text: item.str,
            url: item.url,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width
          });
        }
      }

      // Store links with their position data
      this.hyperlinks.set(pageData.pageNumber, links);

      return text;
    } catch (error) {
      console.error(`Error rendering page: ${error.message}`);
      return '';
    }
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
    links.forEach(link => {
      if (link.text && link.url) {
        const markdownLink = `[${link.text}](${link.url})`;
        // Use regex to replace the exact text while preserving case
        const regex = new RegExp(`(?<!\\[)${this.escapeRegExp(link.text)}(?!\\])`, 'g');
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
      
      // Header detection patterns
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
      
      // Detect list items
      const bulletMatch = trimmedLine.match(/^[-•*]\s+(.+)/);
      const numberMatch = trimmedLine.match(/^(\d+[.)])\s+(.+)/);
      
      if (bulletMatch) {
        inList = true;
        return `- ${bulletMatch[1]}`;
      } else if (numberMatch) {
        inList = true;
        return `${numberMatch[1]} ${numberMatch[2]}`;
      } else if (inList && /^\s+/.test(line)) {
        // Continue list with indentation
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
