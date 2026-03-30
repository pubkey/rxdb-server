const fs = require('node:fs');
const path = require('node:path');

const MAX_LINE_LENGTH = 86;

const IGNORED_DIRS = ['node_modules', 'dist', '.git', 'test-integration'];

function findMarkdownFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORED_DIRS.includes(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findMarkdownFiles(fullPath));
        } else if (entry.name.endsWith('.md')) {
            results.push(fullPath);
        }
    }
    return results;
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const errors = [];
    let inCodeBlock = false;
    let codeBlockStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('```')) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockStartLine = i + 1;
            } else {
                inCodeBlock = false;
            }
            continue;
        }
        if (inCodeBlock && line.length > MAX_LINE_LENGTH) {
            errors.push({
                file: filePath,
                line: i + 1,
                length: line.length,
                content: line
            });
        }
    }
    return errors;
}

const rootDir = path.resolve(__dirname, '..');
const mdFiles = findMarkdownFiles(rootDir);
let allErrors = [];

for (const file of mdFiles) {
    const errors = checkFile(file);
    allErrors.push(...errors);
}

if (allErrors.length > 0) {
    console.error('ERROR: The following lines in code blocks exceed ' + MAX_LINE_LENGTH + ' characters:\n');
    for (const err of allErrors) {
        const relPath = path.relative(rootDir, err.file);
        console.error(relPath + ':' + err.line + ' (' + err.length + ' chars)');
        console.error('  ' + err.content);
        console.error('');
    }
    process.exit(1);
} else {
    console.log('All code block lines are within ' + MAX_LINE_LENGTH + ' characters.');
}
