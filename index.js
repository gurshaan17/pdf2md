const fs = require('fs');
const pdf = require('pdf-parse');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor(options = {}) {
    this.options = {
      preserveFormatting: true,
      includeImages: false,
      preserveLinks: true,
      ...options
    };
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const pdfData = await pdf(dataBuffer);
      
      // Process the raw text content
      const pages = pdfData.text.split(/\f/); // Split by form feed character
      let markdown = pages.map(page => this.processPage(page)).join('\n\n');
      
      if (outputPath) {
        const sanitizedPath = sanitize(outputPath);
        fs.writeFileSync(sanitizedPath, markdown);
      }
      
      return markdown;
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  processPage(pageText) {
    // Remove excessive whitespace while preserving paragraphs
    let text = pageText
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(line => line.trim())
      .join('\n');

    // Process different elements
    text = this.detectAndFormatHeaders(text);
    text = this.detectAndFormatLists(text);
    text = this.formatParagraphs(text);

    return text.trim();
  }

  detectAndFormatHeaders(text) {
    const lines = text.split('\n');
    let formatted = [];
    let previousLineEmpty = true;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      let nextLine = lines[i + 1]?.trim() || '';
      
      // Header detection rules
      if (line && previousLineEmpty && 
          (line.length < 100 && line.toUpperCase() === line || 
           line.match(/^[A-Z][^.!?]*$/))) {
        formatted.push(`# ${line}`);
      } else if (line && nextLine && nextLine.match(/^[=\-]{3,}$/)) {
        formatted.push(`# ${line}`);
        i++; // Skip the underlining
      } else {
        formatted.push(line);
      }
      
      previousLineEmpty = !line;
    }

    return formatted.join('\n');
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    let formatted = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Detect list items
      if (line.match(/^[\d]+[\.)]\s+/)) {
        inList = true;
        formatted.push(line);
      } else if (line.match(/^[-•*]\s+/)) {
        inList = true;
        formatted.push(line.replace(/^[-•*]\s+/, '- '));
      } else if (inList && line.match(/^\s+/)) {
        // Continuation of list item
        formatted.push(line);
      } else {
        inList = false;
        formatted.push(line);
      }
    }

    return formatted.join('\n');
  }

  formatParagraphs(text) {
    // Add proper spacing between paragraphs
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .trim();
  }
}

module.exports = PDFToMarkdown;