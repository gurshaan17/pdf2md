const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
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
      const pdfDocument = await pdfjsLib.getDocument({ data: dataBuffer }).promise;

      let markdown = '';
      for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const pageText = await this.renderPage(page);
        markdown += pageText + '\n\n---\n\n';
      }

      if (outputPath) {
        fs.writeFileSync(sanitize(outputPath), markdown.trim());
      }

      return markdown.trim();
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  async renderPage(page) {
    const textContent = await page.getTextContent();
    const annotations = await page.getAnnotations();

    let text = '';
    let lastY;
    let links = [];

    for (let item of textContent.items) {
      if (lastY !== item.transform[5] && text.length > 0) {
        text += '\n';
      }

      text += item.str;
      lastY = item.transform[5];
    }

    // Extract hyperlinks from annotations
    annotations.forEach(annotation => {
      if (annotation.subtype === 'Link' && annotation.url) {
        links.push({
          text: annotation.title || annotation.url,
          url: annotation.url,
          rect: annotation.rect
        });
      }
    });

    // Store links for this page
    this.hyperlinks.set(page.pageNumber, links);

    return this.insertHyperlinks(text, links);
  }

  insertHyperlinks(text, links) {
    if (!links.length) return text;

    let result = text;
    links.forEach(link => {
      if (link.text && link.url) {
        const markdownLink = `[${link.text}](${link.url})`;
        const regex = new RegExp(`(?<!\\[)${this.escapeRegExp(link.text)}(?!\\])`, 'g');
        result = result.replace(regex, markdownLink);
      }
    });

    return result;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = PDFToMarkdown;
