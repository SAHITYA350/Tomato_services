import fs from 'fs';

const filePath = './src/controllers/ai.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// Normalize line endings to LF
content = content.replace(/\r\n/g, '\n');

// Find the index of "AI Agent Error"
const searchStr = 'AI Agent Error';
const index = content.indexOf(searchStr);

if (index !== -1) {
    console.log("Found search string at index:", index);
    // Find the enclosing catch block start or console.error line
    const startOfLine = content.lastIndexOf('console.error', index);
    
    // Find the end of the return statement (closing });) after the index
    const returnIndex = content.indexOf('return res.status(200).json', index);
    const closingBraceIndex = content.indexOf('});', returnIndex);
    const endOfBlock = closingBraceIndex + 3;

    if (startOfLine !== -1 && returnIndex !== -1 && closingBraceIndex !== -1) {
        const originalBlock = content.substring(startOfLine, endOfBlock);
        console.log("Original block:\n", originalBlock);
        
        const newBlock = `console.error("❌ AI Agent Error:", err.message, err.stack);
            return res.status(200).json({
                text: \`I'm just catching my breath, \${userName}! 😅 Give me a moment and try again. ERROR: \${err.message}\\nSTACK: \${err.stack}\`,
                cartAction: null,
                comboData: null,
            });`;
            
        content = content.substring(0, startOfLine) + newBlock + content.substring(endOfBlock);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log("Replacement successful!");
    } else {
        console.log("Could not find start or end of the catch block.");
    }
} else {
    console.log("Search string not found!");
}
