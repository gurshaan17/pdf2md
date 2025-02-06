const fs = require('fs');
const textract = require('textract');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
    constructor(options = {}) {
        this.options = {
            preserveFormatting: true,
            preserveLinks: true,
            ...options
        };
    }

    async convertFile(pdfPath, outputPath = null) {
        try {
            const text = await this.extractText(pdfPath);
            const markdown = this.processText(text);

            if (outputPath) {
                fs.writeFileSync(sanitize(outputPath), markdown);
            }

            return markdown;
        } catch (error) {
            throw new Error(`Conversion failed: ${error.message}`);
        }
    }

    async extractText(pdfPath) {
        return new Promise((resolve, reject) => {
            textract.fromFileWithPath(pdfPath, {
                preserveLineBreaks: true
            }, function(error, text) {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(text);
            });
        });
    }

    processText(text) {
        // Implement your text processing logic here
        // This is where you convert the extracted text to markdown
        let markdown = text;

        markdown = this.detectAndFormatHeaders(markdown);
        markdown = this.detectAndFormatLists(markdown);

        return markdown;
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